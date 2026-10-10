const mongoose = require("mongoose");
const Product = require("../models/Product");
const Sale = require("../models/Sale");
const Payment = require("../models/Payment");
const Notification = require("../models/Notification");
const Organization = require("../models/Organization");
const User = require("../models/User");
const handleControllerError = require("../utils/controllerError");
const { isValidObjectId, parsePagination } = require("../utils/requestValidation");
const { parseMoneyCents, parseQuantity, formatMoney, parseSaleUnitPriceCents } = require("../utils/salesValidation");
const moveStock = require("../utils/stockMovement");
const notificationHub = require("../utils/notificationHub");
const attachProductImages = require("../utils/productImages");

const organizationId = (req) => req.user.organizationId;
const userId = (req) => req.user.userId;
const centsOut = (cents) => formatMoney(cents || 0);
const normalSalesFilter = (organization) => ({
  organizationId: organization,
  status: { $ne: "cancelled" },
  customerId: { $exists: false }
});
const parseDate = (value, endOfDay = false) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setHours(23, 59, 59, 999);
  return date;
};

const requestSale = async (req, res) => {
  try {
    const { items, paymentMethod = "cash", paidAmount } = req.body || {};
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      return res.status(400).json({ message: "One to 100 sale items are required" });
    }
    if (!["cash", "online", "other"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Payment method must be cash, online, or other" });
    }

    const quantities = new Map();
    for (const item of items) {
      if (!isValidObjectId(item?.productId)) return res.status(400).json({ message: "Invalid product ID" });
      const quantity = parseQuantity(item.quantity);
      if (!quantity) return res.status(400).json({ message: "Each quantity must be a whole number greater than 0" });
      const totalQuantity = (quantities.get(item.productId) || 0) + quantity;
      if (!Number.isSafeInteger(totalQuantity)) return res.status(400).json({ message: "Requested quantity is too large" });
      quantities.set(item.productId, totalQuantity);
    }
    if (paidAmount !== undefined && parseMoneyCents(paidAmount) === null) {
      return res.status(400).json({ message: "Paid amount must be a valid non-negative amount" });
    }

    const products = await Product.find({
      _id: { $in: [...quantities.keys()] }, organizationId: organizationId(req)
    }).lean();
    if (products.length !== quantities.size) {
      return res.status(404).json({ message: "One or more products were not found in this organization" });
    }
    const productById = new Map(products.map((product) => [String(product._id), product]));
    const saleItems = [];
    let totalCents = 0;
    for (const item of items) {
      const product = productById.get(item.productId);
      const quantity = parseQuantity(item.quantity);
      if (quantities.get(item.productId) > product.quantity) {
        return res.status(409).json({ message: `Insufficient stock for ${product.name}` });
      }
      const unitPriceCents = parseSaleUnitPriceCents(product.price, item.unitPrice);
      if (unitPriceCents === null) return res.status(400).json({ message: `Invalid selling price for ${product.name}` });
      const lineTotalCents = quantity * unitPriceCents;
      if (!Number.isSafeInteger(lineTotalCents) || !Number.isSafeInteger(totalCents + lineTotalCents)) {
        return res.status(400).json({ message: "Sale total exceeds the supported range" });
      }
      totalCents += lineTotalCents;
      saleItems.push({ productId: product._id, productName: product.name, quantity, unitPriceCents, lineTotalCents });
    }
    if (!totalCents) return res.status(400).json({ message: "Sale total must be greater than zero" });
    const paidCents = paidAmount === undefined ? totalCents : parseMoneyCents(paidAmount);
    if (paidCents !== totalCents) {
      return res.status(400).json({ message: "Normal sales must be paid in full; use Udhaar for customer credit" });
    }

    const session = await mongoose.startSession();
    let sale;
    let notification;
    let stockNotifications = [];
    try {
      await session.withTransaction(async () => {
        stockNotifications = [];
        const [created] = await Sale.create([{
          items: saleItems,
          totalCents,
          paidCents,
          paymentMethod,
          verification: "none",
          organizationId: organizationId(req),
          createdBy: userId(req)
        }], { session });
        stockNotifications.push(...await moveStock({
          items: saleItems, type: "out", organizationId: organizationId(req),
          userId: userId(req), session, sourceType: "sale", sourceId: created._id
        }));
        await Payment.create([{
          saleId: created._id,
          amountCents: paidCents,
          method: paymentMethod,
          verification: "none",
          organizationId: organizationId(req),
          createdBy: userId(req)
        }], { session });
        [notification] = await Notification.create([{
          organizationId: organizationId(req),
          createdBy: userId(req),
          type: "sale-created",
          title: "Sale recorded",
          message: `A sale of ${formatMoney(totalCents)} was recorded.`,
          entityType: "sale",
          entityId: created._id
        }], { session });
        sale = created;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    notificationHub.publish(notification.toObject());
    for (const stockNotification of stockNotifications) {
      notificationHub.publish(stockNotification.toObject());
    }
    return res.status(201).json({ message: "Sale recorded and stock updated", sale });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Sale creation failed");
  }
};

const listSales = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) return res.status(400).json({ message: "Invalid page or limit" });
    const filter = normalSalesFilter(organizationId(req));
    const { search, startDate, endDate, sort, paymentMethod } = req.query;
    if (search !== undefined) {
      if (typeof search !== "string" || search.length > 100) return res.status(400).json({ message: "Search must be at most 100 characters" });
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (escaped) filter.$or = [
        { "items.productName": { $regex: escaped, $options: "i" } },
        ...(isValidObjectId(search.trim()) ? [{ _id: search.trim() }] : [])
      ];
    }
    if (startDate !== undefined || endDate !== undefined) {
      const start = startDate === undefined ? null : parseDate(startDate);
      const end = endDate === undefined ? null : parseDate(endDate, true);
      if ((startDate !== undefined && !start) || (endDate !== undefined && !end) || (start && end && start > end)) {
        return res.status(400).json({ message: "Invalid date range" });
      }
      filter.createdAt = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
    }
    if (paymentMethod !== undefined) {
      if (!["cash", "online", "other"].includes(paymentMethod)) return res.status(400).json({ message: "Invalid payment method" });
      filter.paymentMethod = paymentMethod;
    }
    const legacySorts = {
      newest: ["createdAt", "desc"],
      oldest: ["createdAt", "asc"],
      total_desc: ["totalCents", "desc"],
      total_asc: ["totalCents", "asc"]
    };
    if (sort !== undefined && (typeof sort !== "string" || !Object.hasOwn(legacySorts, sort))) {
      return res.status(400).json({ message: "Invalid sort order" });
    }
    const [sortBy = "createdAt", sortOrder = "desc"] = sort === undefined
      ? [req.query.sortBy, req.query.sortOrder]
      : legacySorts[sort];
    const sortFields = {
      createdAt: "createdAt",
      totalCents: "totalCents",
      paidCents: "paidCents",
      quantity: "totalQuantity",
      paymentMethod: "paymentMethod",
      soldBy: "creator.name"
    };
    if (
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      !Object.hasOwn(sortFields, sortBy) ||
      !["asc", "desc"].includes(sortOrder)
    ) {
      return res.status(400).json({ message: "Invalid sales sorting options" });
    }
    const direction = sortOrder === "asc" ? 1 : -1;
    const organization = new mongoose.Types.ObjectId(organizationId(req));
    const aggregationFilter = {
      ...filter,
      organizationId: organization,
      ...(filter.$or ? {
        $or: filter.$or.map((condition) => condition._id
          ? { _id: new mongoose.Types.ObjectId(condition._id) }
          : condition)
      } : {})
    };
    const creatorLookup = {
      $lookup: {
        from: User.collection.name,
        localField: "createdBy",
        foreignField: "_id",
        pipeline: [
          { $match: { organizationId: organization } },
          { $project: { name: 1 } }
        ],
        as: "creator"
      }
    };
    const salesPipeline = [
      { $match: aggregationFilter },
      ...(sortBy === "soldBy" ? [creatorLookup] : []),
      ...(sortBy === "quantity" ? [{ $set: { totalQuantity: { $sum: "$items.quantity" } } }] : []),
      { $sort: { [sortFields[sortBy]]: direction, _id: direction } },
      { $skip: pagination.skip },
      { $limit: pagination.limit },
      ...(sortBy === "soldBy" ? [] : [creatorLookup]),
      {
        $set: {
          createdBy: { $ifNull: [{ $arrayElemAt: ["$creator", 0] }, null] }
        }
      },
      { $project: { creator: 0, totalQuantity: 0 } }
    ];
    const [total, salesResult] = await Promise.all([
      Sale.countDocuments(filter),
      Sale.aggregate(salesPipeline)
    ]);
    const sales = await attachProductImages(salesResult, organizationId(req));
    return res.json({ page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit), sales });
  } catch (error) {
    return handleControllerError(res, error, "Sales listing failed");
  }
};

const getSale = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid sale ID" });
    const sale = await Sale.findOne({
      _id: req.params.id, ...normalSalesFilter(organizationId(req))
    }).populate({ path: "createdBy", select: "name", match: { organizationId: organizationId(req) } }).lean();
    if (!sale) return res.status(404).json({ message: "Sale not found" });
    const [saleWithImages] = await attachProductImages([sale], organizationId(req));
    const [payments, organization] = await Promise.all([
      Payment.find({ saleId: sale._id, organizationId: organizationId(req) }).sort({ createdAt: 1 }).lean(),
      Organization.findById(organizationId(req)).select("name").lean()
    ]);
    const canViewPayments = String(req.user.role).toLowerCase() === "admin" ||
      req.user.permissions?.includes("payments.history") ||
      req.user.permissions?.includes("udhaar.payment-history");
    return res.json({
      sale: saleWithImages,
      payments: canViewPayments ? payments : [],
      organizationName: organization?.name || ""
    });
  } catch (error) {
    return handleControllerError(res, error, "Sale lookup failed");
  }
};

const cancelSale = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid sale ID" });
    const session = await mongoose.startSession();
    let cancelledSale;
    let stockNotifications = [];
    try {
      await session.withTransaction(async () => {
        stockNotifications = [];
        const sale = await Sale.findOne({
          _id: req.params.id, ...normalSalesFilter(organizationId(req))
        }).session(session);
        if (!sale) throw Object.assign(new Error("Sale not found"), { status: 404 });
        if (sale.status === "cancelled") throw Object.assign(new Error("Sale is already cancelled"), { status: 409 });
        if (sale.paidCents !== 0) {
          throw Object.assign(new Error("Paid sales cannot be cancelled; process a refund separately"), { status: 409 });
        }
        for (const item of sale.items) {
          stockNotifications.push(...await moveStock({
            items: [{ productId: item.productId, quantity: item.quantity }],
            type: "in", organizationId: organizationId(req), userId: userId(req), session,
            sourceType: "sale", sourceId: sale._id
          }));
        }
        sale.status = "cancelled";
        sale.cancelledAt = new Date();
        sale.cancelledBy = userId(req);
        await sale.save({ session });
        cancelledSale = sale;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    for (const stockNotification of stockNotifications) {
      notificationHub.publish(stockNotification.toObject());
    }
    return res.json({ message: "Sale cancelled and inventory restored", sale: cancelledSale });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Sale cancellation failed");
  }
};

const analytics = async (req, res) => {
  try {
    const organization = new mongoose.Types.ObjectId(organizationId(req));
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const baseFilter = { ...normalSalesFilter(organization) };
    const [totalsRows, todayRows, monthRows, trend, products, methods, sellers] = await Promise.all([
      Sale.aggregate([
        { $match: baseFilter },
        { $set: { productUnits: { $sum: "$items.quantity" } } },
        { $group: { _id: null, totalCents: { $sum: "$totalCents" }, paidCents: { $sum: "$paidCents" }, count: { $sum: 1 }, productsSold: { $sum: "$productUnits" } } }
      ]),
      Sale.aggregate([{ $match: { ...baseFilter, createdAt: { $gte: dayStart } } }, { $group: { _id: null, totalCents: { $sum: "$totalCents" }, paidCents: { $sum: "$paidCents" }, count: { $sum: 1 } } }]),
      Sale.aggregate([{ $match: { ...baseFilter, createdAt: { $gte: monthStart } } }, { $group: { _id: null, totalCents: { $sum: "$totalCents" }, paidCents: { $sum: "$paidCents" }, count: { $sum: 1 } } }]),
      Sale.aggregate([
        { $match: { ...baseFilter, createdAt: { $gte: new Date(now.getTime() - 29 * 86400000) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, totalCents: { $sum: "$totalCents" }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      Sale.aggregate([
        { $match: baseFilter }, { $unwind: "$items" },
        { $group: { _id: "$items.productId", name: { $first: "$items.productName" }, quantity: { $sum: "$items.quantity" }, revenueCents: { $sum: "$items.lineTotalCents" } } },
        { $sort: { quantity: -1, revenueCents: -1 } }, { $limit: 10 },
        {
          $lookup: {
            from: Product.collection.name,
            let: { productId: "$_id" },
            pipeline: [
              { $match: { $expr: { $and: [
                { $eq: ["$_id", "$$productId"] },
                { $eq: ["$organizationId", organization] }
              ] } } },
              { $project: { image: 1 } }
            ],
            as: "product"
          }
        },
        { $set: { image: { $ifNull: [{ $arrayElemAt: ["$product.image", 0] }, ""] } } },
        { $project: { product: 0 } }
      ]),
      Sale.aggregate([{ $match: baseFilter }, { $group: { _id: "$paymentMethod", totalCents: { $sum: "$totalCents" }, count: { $sum: 1 } } }, { $sort: { totalCents: -1 } }]),
      Sale.aggregate([
        { $match: baseFilter }, { $group: { _id: "$createdBy", totalCents: { $sum: "$totalCents" }, count: { $sum: 1 } } },
        { $lookup: {
          from: User.collection.name,
          let: { sellerId: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$_id", "$$sellerId"] },
              { $eq: ["$organizationId", organization] }
            ] } } },
            { $project: { name: 1 } }
          ],
          as: "seller"
        } },
        { $set: { sellerName: { $ifNull: [{ $arrayElemAt: ["$seller.name", 0] }, "Unknown user"] } } },
        { $sort: { totalCents: -1 } }
      ])
    ]);
    const toSummary = (row = {}) => ({ totalSales: centsOut(row.totalCents), totalCollected: centsOut(row.paidCents), salesCount: row.count || 0 });
    const totals = totalsRows[0] || {};
    return res.json({
      totals: { ...toSummary(totals), productsSold: totals.productsSold || 0 },
      today: toSummary(todayRows[0]),
      month: toSummary(monthRows[0]),
      salesTrend: trend.map((row) => ({ date: row._id, sales: centsOut(row.totalCents), saleCount: row.count })),
      productLeaders: products.map((row) => ({ productId: row._id, name: row.name, image: row.image, quantity: row.quantity, revenue: centsOut(row.revenueCents) })),
      paymentMethods: methods.map((row) => ({ method: row._id || "other", sales: centsOut(row.totalCents), saleCount: row.count })),
      sellers: sellers.map((row) => ({ userId: row._id, name: row.sellerName, sales: centsOut(row.totalCents), saleCount: row.count }))
    });
  } catch (error) {
    return handleControllerError(res, error, "Sales analytics request failed");
  }
};

module.exports = { requestSale, listSales, getSale, cancelSale, analytics };
