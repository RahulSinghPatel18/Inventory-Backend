const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const Product = require("../models/Product");
const Udhaar = require("../models/Udhaar");
const Payment = require("../models/Payment");
const Organization = require("../models/Organization");
const User = require("../models/User");
const handleControllerError = require("../utils/controllerError");
const { isValidObjectId, parsePagination } = require("../utils/requestValidation");
const { parseMoneyCents, parseQuantity, formatMoney, parseSaleUnitPriceCents } = require("../utils/salesValidation");
const moveStock = require("../utils/stockMovement");
const attachProductImages = require("../utils/productImages");

const adminRoles = new Set(["admin", "Admin"]);
const organizationId = (req) => req.user.organizationId;
const userId = (req) => req.user.userId;
const centsOut = (cents) => formatMoney(cents || 0);
const validOptionalString = (value, maximum) => (
  typeof value === "string" && value.trim().length <= maximum ? value.trim() : null
);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getPaymentStatus = (totalCents, paidCents) => (
  paidCents >= totalCents ? "paid" : paidCents > 0 ? "partial" : "pending"
);

const createCustomer = async (req, res) => {
  try {
    const { name, phone } = req.body || {};
    const cleanName = validOptionalString(name, 120);
    if (!cleanName) return res.status(400).json({ message: "Enter a valid customer name" });
    if (typeof phone !== "string" || !/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({ message: "Phone number must contain exactly 10 digits (0-9)" });
    }
    const cleanPhone = phone;
    const existingCustomer = await Customer.findOne({
      organizationId: organizationId(req),
      archivedAt: null,
      phone: cleanPhone,
      name: { $regex: `^${escapeRegex(cleanName)}$`, $options: "i" }
    }).lean();
    if (existingCustomer) {
      return res.json({ message: "Customer already exists", customer: existingCustomer });
    }
    const customer = await Customer.create({
      name: cleanName,
      phone: cleanPhone,
      organizationId: organizationId(req),
      createdBy: userId(req)
    });
    return res.status(201).json({ customer });
  } catch (error) {
    return handleControllerError(res, error, "Customer creation failed");
  }
};

const listCustomers = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) return res.status(400).json({ message: "Invalid page or limit" });
    const sortFields = {
      name: "name",
      phone: "phone",
      totalUdhaar: "totalUdhaar",
      totalPaid: "totalPaid",
      pendingAmount: "pendingAmount",
      lastTransaction: "lastTransaction",
      status: "status"
    };
    const sortBy = req.query.sortBy || "name";
    const order = req.query.sortOrder ?? req.query.order ?? "asc";
    if (
      typeof sortBy !== "string" ||
      typeof order !== "string" ||
      !sortFields[sortBy] ||
      !["asc", "desc"].includes(order)
    ) {
      return res.status(400).json({ message: "Invalid customer sorting options" });
    }
    const filter = {
      organizationId: new mongoose.Types.ObjectId(organizationId(req)),
      archivedAt: null
    };
    if (req.query.search !== undefined) {
      if (typeof req.query.search !== "string" || req.query.search.length > 100) return res.status(400).json({ message: "Search must be at most 100 characters" });
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (escaped) filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { phone: { $regex: escaped, $options: "i" } }
      ];
    }
    if (req.query.hasBalance !== undefined && !["true", "false"].includes(req.query.hasBalance)) {
      return res.status(400).json({ message: "hasBalance must be true or false" });
    }
    if (req.query.status !== undefined && !["pending", "partial", "paid", "active"].includes(req.query.status)) {
      return res.status(400).json({ message: "Invalid customer status" });
    }
    const dateFilter = {};
    for (const key of ["startDate", "endDate"]) {
      if (req.query[key] !== undefined) {
        if (typeof req.query[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(req.query[key])) {
          return res.status(400).json({ message: `Invalid ${key}` });
        }
        const date = new Date(`${req.query[key]}T00:00:00.000Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== req.query[key]) {
          return res.status(400).json({ message: `Invalid ${key}` });
        }
        dateFilter[key] = date;
      }
    }
    if (dateFilter.startDate && dateFilter.endDate && dateFilter.startDate > dateFilter.endDate) {
      return res.status(400).json({ message: "Start date must not be after end date" });
    }
    const lastTransactionFilter = {};
    if (dateFilter.startDate) lastTransactionFilter.$gte = dateFilter.startDate;
    if (dateFilter.endDate) {
      dateFilter.endDate.setUTCHours(23, 59, 59, 999);
      lastTransactionFilter.$lte = dateFilter.endDate;
    }
    const pipeline = [
      { $match: filter },
      { $lookup: {
        from: Udhaar.collection.name,
        let: { customerRef: "$_id", organizationRef: "$organizationId" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$customerId", "$$customerRef"] },
            { $eq: ["$organizationId", "$$organizationRef"] },
            { $eq: ["$status", "active"] }
          ] } } },
          { $group: {
            _id: null,
            totalUdhaarCents: { $sum: "$totalCents" },
            totalPaidCents: { $sum: "$paidCents" },
            recordCount: { $sum: 1 },
            lastUdhaarAt: { $max: "$createdAt" }
          } }
        ],
        as: "summary"
      } },
      { $lookup: {
        from: Payment.collection.name,
        let: { customerRef: "$_id", organizationRef: "$organizationId" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$customerId", "$$customerRef"] },
            { $eq: ["$organizationId", "$$organizationRef"] },
            { $eq: [{ $type: "$udhaarId" }, "objectId"] }
          ] } } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { createdAt: 1 } }
        ],
        as: "latestPayment"
      } },
      { $set: {
        summary: { $ifNull: [{ $arrayElemAt: ["$summary", 0] }, { totalUdhaarCents: 0, totalPaidCents: 0, recordCount: 0, lastUdhaarAt: null }] }
      } },
      { $set: {
        totalUdhaar: { $divide: ["$summary.totalUdhaarCents", 100] },
        totalPurchases: { $divide: ["$summary.totalUdhaarCents", 100] },
        totalPaid: { $divide: ["$summary.totalPaidCents", 100] },
        pendingAmount: { $divide: [{ $subtract: ["$summary.totalUdhaarCents", "$summary.totalPaidCents"] }, 100] },
        salesCount: "$summary.recordCount",
        lastSaleDate: "$summary.lastUdhaarAt",
        lastTransaction: {
          $cond: [
            { $gt: [{ $arrayElemAt: ["$latestPayment.createdAt", 0] }, "$summary.lastUdhaarAt"] },
            { $arrayElemAt: ["$latestPayment.createdAt", 0] },
            "$summary.lastUdhaarAt"
          ]
        },
        activeUdhaarCount: "$summary.recordCount",
        status: {
          $cond: [
            { $gt: [{ $subtract: ["$summary.totalUdhaarCents", "$summary.totalPaidCents"] }, 0] },
            { $cond: [{ $gt: ["$summary.totalPaidCents", 0] }, "partial", "pending"] },
            { $cond: [{ $gt: ["$summary.recordCount", 0] }, "paid", "none"] }
          ]
        }
      } },
      ...(req.query.hasBalance === "true" ? [{ $match: { pendingAmount: { $gt: 0 } } }] : []),
      ...(req.query.hasBalance === "false" ? [{ $match: { pendingAmount: { $lte: 0 } } }] : []),
      ...(req.query.status === "pending" ? [{ $match: { status: "pending" } }] : []),
      ...(req.query.status === "partial" ? [{ $match: { status: "partial" } }] : []),
      ...(req.query.status === "paid" ? [{ $match: { pendingAmount: { $lte: 0 } } }] : []),
      ...(req.query.status === "active" ? [{ $match: { activeUdhaarCount: { $gt: 0 } } }] : []),
      ...(Object.keys(lastTransactionFilter).length ? [{ $match: { lastTransaction: lastTransactionFilter } }] : []),
      { $sort: { [sortFields[sortBy]]: order === "asc" ? 1 : -1, _id: 1 } },
      { $facet: {
        metadata: [{ $count: "total" }],
        balances: [{ $group: { _id: null, totalPending: { $sum: "$pendingAmount" } } }],
        customers: [{ $skip: pagination.skip }, { $limit: pagination.limit }]
      } }
    ];
    const [result = { metadata: [], balances: [], customers: [] }] = await Customer.aggregate(pipeline);
    const customers = result.customers.map(({ summary, latestPayment, ...customer }) => customer);
    const total = result.metadata[0]?.total || 0;
    return res.json({
      page: pagination.page, limit: pagination.limit, total,
      totalPending: result.balances[0]?.totalPending || 0,
      totalPages: Math.ceil(total / pagination.limit), customers
    });
  } catch (error) {
    return handleControllerError(res, error, "Customer listing failed");
  }
};

const listUdhaarCustomers = (req, res) => {
  return listCustomers(req, res);
};

const getCustomer = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid customer ID" });
    const customer = await Customer.findOne({ _id: req.params.id, organizationId: organizationId(req) }).lean();
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    return res.json({ customer });
  } catch (error) {
    return handleControllerError(res, error, "Customer lookup failed");
  }
};

const updateCustomer = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid customer ID" });
    const { name, phone } = req.body || {};
    const update = {};
    if (name !== undefined) {
      update.name = validOptionalString(name, 120);
      if (!update.name) return res.status(400).json({ message: "Invalid customer name" });
    }
    if (phone !== undefined) {
      if (typeof phone !== "string" || !/^[0-9]{10}$/.test(phone)) {
        return res.status(400).json({ message: "Phone number must contain exactly 10 digits (0-9)" });
      }
      update.phone = phone;
    }
    if (!Object.keys(update).length) return res.status(400).json({ message: "Provide a customer name or phone to update" });
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, organizationId: organizationId(req), archivedAt: null },
      { $set: update }, { new: true, runValidators: true }
    );
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    return res.json({ customer });
  } catch (error) {
    return handleControllerError(res, error, "Customer update failed");
  }
};

const archiveCustomer = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid customer ID" });
    const customer = await Customer.findOne({
      _id: req.params.id,
      organizationId: organizationId(req),
      archivedAt: null
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const [balance] = await Udhaar.aggregate([
      {
        $match: {
          customerId: customer._id,
          organizationId: new mongoose.Types.ObjectId(organizationId(req)),
          status: "active"
        }
      },
      {
        $group: {
          _id: null,
          outstandingCents: { $sum: { $subtract: ["$totalCents", "$paidCents"] } }
        }
      }
    ]);
    if ((balance?.outstandingCents || 0) > 0) {
      return res.status(409).json({
        message: "Settle this customer's outstanding Udhaar before deleting the customer."
      });
    }

    const archived = await Customer.updateOne(
      { _id: customer._id, organizationId: organizationId(req), archivedAt: null },
      { $set: { archivedAt: new Date() } }
    );
    if (!archived.matchedCount) return res.status(404).json({ message: "Customer not found" });
    return res.json({ message: "Customer archived and financial history preserved", customerId: customer._id });
  } catch (error) {
    return handleControllerError(res, error, "Customer deletion failed");
  }
};

const listUdhaar = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) return res.status(400).json({ message: "Invalid page or limit" });
    const filter = { organizationId: organizationId(req) };
    if (req.query.status !== undefined) {
      if (!["active", "cancelled"].includes(req.query.status)) return res.status(400).json({ message: "Invalid Udhaar status" });
      filter.status = req.query.status;
    }
    if (req.query.paymentStatus !== undefined) {
      if (!["pending", "partial", "paid"].includes(req.query.paymentStatus)) return res.status(400).json({ message: "Invalid Udhaar payment status" });
      filter.paymentStatus = req.query.paymentStatus;
    }
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder || "desc";
    const sortFields = {
      createdAt: "createdAt",
      customer: "customerId.name",
      totalCents: "totalCents",
      paidCents: "paidCents",
      pendingCents: "pendingCents",
      status: "displayStatus",
      createdBy: "createdBy.name"
    };
    if (
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      !Object.hasOwn(sortFields, sortBy) ||
      !["asc", "desc"].includes(sortOrder)
    ) {
      return res.status(400).json({ message: "Invalid Udhaar sorting options" });
    }
    const organization = new mongoose.Types.ObjectId(organizationId(req));
    const direction = sortOrder === "asc" ? 1 : -1;
    const simpleSortFields = ["createdAt", "totalCents", "paidCents"];
    const recordQuery = simpleSortFields.includes(sortBy)
      ? Udhaar.find(filter)
        .sort({ [sortFields[sortBy]]: direction, _id: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate({ path: "customerId", select: "name phone", match: { organizationId: organizationId(req) } })
        .populate({ path: "createdBy", select: "name", match: { organizationId: organizationId(req) } })
        .lean()
      : Udhaar.aggregate([
        { $match: { ...filter, organizationId: organization } },
        {
          $lookup: {
            from: Customer.collection.name,
            localField: "customerId",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: organization } },
              { $project: { name: 1, phone: 1 } }
            ],
            as: "customerDetails"
          }
        },
        {
          $lookup: {
            from: User.collection.name,
            localField: "createdBy",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: organization } },
              { $project: { name: 1 } }
            ],
            as: "creatorDetails"
          }
        },
        {
          $set: {
            customerId: { $ifNull: [{ $arrayElemAt: ["$customerDetails", 0] }, null] },
            createdBy: { $ifNull: [{ $arrayElemAt: ["$creatorDetails", 0] }, null] },
            pendingCents: { $subtract: ["$totalCents", "$paidCents"] },
            displayStatus: {
              $cond: [{ $eq: ["$status", "cancelled"] }, "cancelled", "$paymentStatus"]
            }
          }
        },
        { $sort: { [sortFields[sortBy]]: direction, _id: 1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        { $project: { customerDetails: 0, creatorDetails: 0, displayStatus: 0, pendingCents: 0 } }
      ]);
    const [total, recordsResult] = await Promise.all([
      Udhaar.countDocuments(filter),
      recordQuery
    ]);
    const records = await attachProductImages(recordsResult, organizationId(req));
    return res.json({ page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit), udhaar: records });
  } catch (error) {
    return handleControllerError(res, error, "Udhaar listing failed");
  }
};

const createUdhaar = async (req, res) => {
  try {
    const { customerId, items = [], totalAmount, paidAmount = 0, paymentMethod = "cash" } = req.body || {};
    if (!isValidObjectId(customerId)) return res.status(400).json({ message: "Select a valid customer" });
    if (!Array.isArray(items) || items.length > 100) return res.status(400).json({ message: "Udhaar items must be a list of up to 100 products" });
    if (!["cash", "online", "other"].includes(paymentMethod)) return res.status(400).json({ message: "Invalid payment method" });
    const customer = await Customer.findOne({ _id: customerId, organizationId: organizationId(req), archivedAt: null }).lean();
    if (!customer) return res.status(404).json({ message: "Customer not found in this organization" });

    const quantities = new Map();
    for (const item of items) {
      if (!isValidObjectId(item?.productId)) return res.status(400).json({ message: "Invalid product ID" });
      const quantity = parseQuantity(item.quantity);
      if (!quantity) return res.status(400).json({ message: "Each product quantity must be a whole number greater than 0" });
      const totalQuantity = (quantities.get(item.productId) || 0) + quantity;
      if (!Number.isSafeInteger(totalQuantity)) return res.status(400).json({ message: "Requested quantity is too large" });
      quantities.set(item.productId, totalQuantity);
    }
    const products = items.length ? await Product.find({
      _id: { $in: [...quantities.keys()] }, organizationId: organizationId(req)
    }).lean() : [];
    if (products.length !== quantities.size) return res.status(404).json({ message: "One or more products were not found in this organization" });
    const productById = new Map(products.map((product) => [String(product._id), product]));
    const udhaarItems = [];
    let calculatedCents = 0;
    for (const item of items) {
      const product = productById.get(item.productId);
      const quantity = parseQuantity(item.quantity);
      if (quantities.get(item.productId) > product.quantity) return res.status(409).json({ message: `Insufficient stock for ${product.name}` });
      const unitPriceCents = parseSaleUnitPriceCents(product.price, item.unitPrice);
      if (unitPriceCents === null) return res.status(400).json({ message: `Invalid selling price for ${product.name}` });
      const lineTotalCents = quantity * unitPriceCents;
      if (!Number.isSafeInteger(lineTotalCents) || !Number.isSafeInteger(calculatedCents + lineTotalCents)) return res.status(400).json({ message: "Udhaar total exceeds the supported range" });
      calculatedCents += lineTotalCents;
      udhaarItems.push({ productId: product._id, productName: product.name, quantity, unitPriceCents, lineTotalCents });
    }
    const totalCents = totalAmount === undefined && items.length
      ? calculatedCents
      : parseMoneyCents(totalAmount);
    const paidCents = parseMoneyCents(paidAmount);
    if (totalCents === null || totalCents < 1 || paidCents === null || paidCents > totalCents) {
      return res.status(400).json({ message: "Enter a valid Udhaar total and paid amount not exceeding the total" });
    }
    if (items.length && calculatedCents !== totalCents) {
      return res.status(400).json({ message: "Udhaar total must match the total value of the selected products" });
    }

    const session = await mongoose.startSession();
    let udhaar;
    try {
      await session.withTransaction(async () => {
        const [created] = await Udhaar.create([{
          customerId,
          items: udhaarItems,
          totalCents,
          paidCents,
          paymentStatus: getPaymentStatus(totalCents, paidCents),
          paymentMethod,
          organizationId: organizationId(req),
          createdBy: userId(req)
        }], { session });
        if (udhaarItems.length) {
          await moveStock({
            items: udhaarItems, type: "out", organizationId: organizationId(req),
            userId: userId(req), session, sourceType: "udhaar", sourceId: created._id
          });
        }
        if (paidCents > 0) {
          await Payment.create([{
            udhaarId: created._id, customerId, amountCents: paidCents,
            method: paymentMethod, verification: "none",
            organizationId: organizationId(req), createdBy: userId(req)
          }], { session });
        }
        udhaar = created;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return res.status(201).json({ message: "Udhaar recorded", udhaar });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Udhaar creation failed");
  }
};

const updateUdhaar = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid Udhaar ID" });
    const keys = Object.keys(req.body || {});
    if (keys.length !== 1 || keys[0] !== "totalAmount") {
      return res.status(400).json({ message: "Only the total amount of a money-only Udhaar can be edited" });
    }
    const totalCents = parseMoneyCents(req.body.totalAmount);
    if (totalCents === null || totalCents < 1) {
      return res.status(400).json({ message: "Enter a valid Udhaar amount greater than zero" });
    }

    const session = await mongoose.startSession();
    let udhaar;
    try {
      await session.withTransaction(async () => {
        udhaar = await Udhaar.findOne({
          _id: req.params.id,
          organizationId: organizationId(req)
        }).session(session);
        if (!udhaar) throw Object.assign(new Error("Udhaar not found"), { status: 404 });
        if (udhaar.status !== "active") throw Object.assign(new Error("Cancelled Udhaar cannot be edited"), { status: 409 });
        if (udhaar.items.length) {
          throw Object.assign(new Error("Product-backed Udhaar cannot be edited because it is linked to stock history"), { status: 409 });
        }
        if (totalCents < udhaar.paidCents) {
          throw Object.assign(new Error("Udhaar total cannot be less than the amount already paid"), { status: 409 });
        }
        udhaar.totalCents = totalCents;
        udhaar.paymentStatus = getPaymentStatus(totalCents, udhaar.paidCents);
        await udhaar.save({ session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return res.json({ message: "Udhaar amount updated", udhaar });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Udhaar update failed");
  }
};

const getUdhaar = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid Udhaar ID" });
    const [udhaar, payments, organization] = await Promise.all([
      Udhaar.findOne({ _id: req.params.id, organizationId: organizationId(req) })
        .populate({ path: "customerId", select: "name phone", match: { organizationId: organizationId(req) } })
        .populate({ path: "createdBy", select: "name", match: { organizationId: organizationId(req) } })
        .lean(),
      Payment.find({ udhaarId: req.params.id, organizationId: organizationId(req) }).sort({ createdAt: 1 })
        .populate({ path: "createdBy", select: "name", match: { organizationId: organizationId(req) } }).lean(),
      Organization.findById(organizationId(req)).select("name").lean()
    ]);
    if (!udhaar) return res.status(404).json({ message: "Udhaar not found" });
    const [udhaarWithImages] = await attachProductImages([udhaar], organizationId(req));
    const canViewPayments = adminRoles.has(req.user.role) ||
      req.user.permissions?.includes("payments.history") ||
      req.user.permissions?.includes("udhaar.payment-history");
    return res.json({ udhaar: udhaarWithImages, payments: canViewPayments ? payments : [], organizationName: organization?.name || "" });
  } catch (error) {
    return handleControllerError(res, error, "Udhaar lookup failed");
  }
};

const cancelUdhaar = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid Udhaar ID" });
    const session = await mongoose.startSession();
    let udhaar;
    try {
      await session.withTransaction(async () => {
        udhaar = await Udhaar.findOne({ _id: req.params.id, organizationId: organizationId(req) }).session(session);
        if (!udhaar) throw Object.assign(new Error("Udhaar not found"), { status: 404 });
        if (udhaar.status === "cancelled") throw Object.assign(new Error("Udhaar is already cancelled"), { status: 409 });
        if (udhaar.paidCents > 0) throw Object.assign(new Error("Udhaar with payments cannot be cancelled; keep the financial history intact"), { status: 409 });
        if (await Payment.exists({ udhaarId: udhaar._id, organizationId: organizationId(req) }).session(session)) {
          throw Object.assign(new Error("Udhaar with payment history cannot be cancelled"), { status: 409 });
        }
        if (udhaar.items.length) {
          await moveStock({
            items: udhaar.items, type: "in", organizationId: organizationId(req),
            userId: userId(req), session, sourceType: "udhaar", sourceId: udhaar._id
          });
        }
        udhaar.status = "cancelled";
        udhaar.cancelledAt = new Date();
        udhaar.cancelledBy = userId(req);
        await udhaar.save({ session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return res.json({ message: "Udhaar cancelled and inventory restored", udhaar });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Udhaar cancellation failed");
  }
};

const recordPayment = async (req, res) => {
  try {
    const customerId = req.params.customerId || req.params.id;
    if (!isValidObjectId(customerId)) return res.status(400).json({ message: "Invalid customer ID" });
    const amountCents = parseMoneyCents(req.body?.amount);
    const method = req.body?.method || "cash";
    if (amountCents === null || amountCents < 1 || !["cash", "online", "other"].includes(method)) {
      return res.status(400).json({ message: "Enter a positive payment amount and valid method" });
    }
    const session = await mongoose.startSession();
    let payments = [];
    try {
      await session.withTransaction(async () => {
        const customer = await Customer.findOne({ _id: customerId, organizationId: organizationId(req) }).session(session);
        if (!customer) throw Object.assign(new Error("Customer not found"), { status: 404 });
        const udhaarRecords = await Udhaar.find({
          customerId, organizationId: organizationId(req), status: "active",
          paymentStatus: { $in: ["pending", "partial"] }
        }).sort({ createdAt: 1, _id: 1 }).session(session);
        let remaining = amountCents;
        for (const record of udhaarRecords) {
          if (remaining <= 0) break;
          const outstanding = record.totalCents - record.paidCents;
          const allocation = Math.min(outstanding, remaining);
          if (allocation <= 0) continue;
          record.paidCents += allocation;
          record.paymentStatus = getPaymentStatus(record.totalCents, record.paidCents);
          await record.save({ session });
          const [payment] = await Payment.create([{
            udhaarId: record._id, customerId, amountCents: allocation, method,
            verification: "none", organizationId: organizationId(req), createdBy: userId(req)
          }], { session });
          payments.push(payment);
          remaining -= allocation;
        }
        if (remaining > 0) throw Object.assign(new Error("Payment exceeds the current outstanding Udhaar balance"), { status: 409 });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return res.status(201).json({ message: "Payment recorded", payments });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Payment recording failed");
  }
};

const customerLedger = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid customer ID" });
    const udhaarPagination = parsePagination({ page: req.query.udhaarPage || req.query.salesPage || 1, limit: req.query.udhaarLimit || req.query.salesLimit || 10 });
    const paymentsPagination = parsePagination({ page: req.query.paymentsPage || 1, limit: req.query.paymentsLimit || 10 });
    const ledgerPagination = parsePagination({ page: req.query.ledgerPage || 1, limit: req.query.ledgerLimit || 20 });
    if (!udhaarPagination || !paymentsPagination || !ledgerPagination) return res.status(400).json({ message: "Invalid Udhaar, payment or ledger pagination" });
    const udhaarSortBy = req.query.udhaarSortBy || "createdAt";
    const udhaarSortOrder = req.query.udhaarSortOrder || "desc";
    const udhaarSortFields = {
      createdAt: "createdAt",
      totalCents: "totalCents",
      paidCents: "paidCents",
      pendingCents: "pendingCents",
      status: "paymentStatus"
    };
    const paymentsSortBy = req.query.paymentsSortBy || "createdAt";
    const paymentsSortOrder = req.query.paymentsSortOrder || "desc";
    const paymentsSortFields = {
      createdAt: "createdAt",
      amountCents: "amountCents",
      method: "method",
      createdBy: "recordedBy.name"
    };
    if (
      typeof udhaarSortBy !== "string" ||
      typeof udhaarSortOrder !== "string" ||
      typeof paymentsSortBy !== "string" ||
      typeof paymentsSortOrder !== "string" ||
      !Object.hasOwn(udhaarSortFields, udhaarSortBy) ||
      !["asc", "desc"].includes(udhaarSortOrder) ||
      !Object.hasOwn(paymentsSortFields, paymentsSortBy) ||
      !["asc", "desc"].includes(paymentsSortOrder)
    ) {
      return res.status(400).json({ message: "Invalid ledger sorting options" });
    }
    const customer = await Customer.findOne({ _id: req.params.id, organizationId: organizationId(req) }).lean();
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    const baseFilter = {
      customerId: customer._id,
      organizationId: new mongoose.Types.ObjectId(organizationId(req))
    };
    const [summaryRows, udhaarCount, paymentCount, udhaar, payments, organization, lastPayment, ledgerResult] = await Promise.all([
      Udhaar.aggregate([
        { $match: { ...baseFilter, status: "active" } },
        { $group: { _id: null, totalUdhaarCents: { $sum: "$totalCents" }, totalPaidCents: { $sum: "$paidCents" }, count: { $sum: 1 }, lastUdhaarAt: { $max: "$createdAt" } } }
      ]),
      Udhaar.countDocuments(baseFilter),
      adminRoles.has(req.user.role) ||
      req.user.permissions?.includes("payments.history") ||
      req.user.permissions?.includes("udhaar.payment-history")
        ? Payment.countDocuments({ ...baseFilter, udhaarId: { $exists: true } })
        : Promise.resolve(0),
      Udhaar.aggregate([
        { $match: baseFilter },
        {
          $lookup: {
            from: User.collection.name,
            localField: "createdBy",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: new mongoose.Types.ObjectId(organizationId(req)) } },
              { $project: { name: 1 } }
            ],
            as: "recordedBy"
          }
        },
        {
          $set: {
            createdBy: { $ifNull: [{ $arrayElemAt: ["$recordedBy", 0] }, null] },
            pendingCents: { $subtract: ["$totalCents", "$paidCents"] }
          }
        },
        { $sort: { [udhaarSortFields[udhaarSortBy]]: udhaarSortOrder === "asc" ? 1 : -1, _id: 1 } },
        { $skip: udhaarPagination.skip },
        { $limit: udhaarPagination.limit },
        { $project: { recordedBy: 0, pendingCents: 0 } }
      ]),
      adminRoles.has(req.user.role) ||
      req.user.permissions?.includes("payments.history") ||
      req.user.permissions?.includes("udhaar.payment-history")
        ? Payment.aggregate([
          { $match: { ...baseFilter, udhaarId: { $exists: true } } },
          {
            $lookup: {
              from: User.collection.name,
              localField: "createdBy",
              foreignField: "_id",
              pipeline: [
                { $match: { organizationId: new mongoose.Types.ObjectId(organizationId(req)) } },
                { $project: { name: 1 } }
              ],
              as: "recordedBy"
            }
          },
          { $set: { "createdBy": { $ifNull: [{ $arrayElemAt: ["$recordedBy", 0] }, null] } } },
          { $sort: { [paymentsSortFields[paymentsSortBy]]: paymentsSortOrder === "asc" ? 1 : -1, _id: 1 } },
          { $skip: paymentsPagination.skip },
          { $limit: paymentsPagination.limit },
          { $project: { recordedBy: 0 } }
        ])
        : Promise.resolve([]),
      Organization.findById(organizationId(req)).select("name").lean(),
      Payment.findOne({ ...baseFilter, udhaarId: { $exists: true } }).sort({ createdAt: -1 }).select("createdAt").lean(),
      Udhaar.aggregate([
        { $match: baseFilter },
        { $project: {
          _id: 1, createdAt: 1, createdBy: 1, sequence: { $literal: 0 },
          type: { $literal: "udhaar" }, status: 1,
          udhaarAmountCents: "$totalCents", paymentAmountCents: { $literal: 0 },
          balanceDelta: { $cond: [{ $eq: ["$status", "active"] }, "$totalCents", 0] }
        } },
        { $unionWith: {
          coll: Payment.collection.name,
          pipeline: [
            { $match: { ...baseFilter, udhaarId: { $exists: true } } },
            { $project: {
              _id: 1, createdAt: 1, createdBy: 1, sequence: { $literal: 1 },
              type: { $literal: "payment" }, udhaarId: 1, udhaarAmountCents: { $literal: 0 },
              paymentAmountCents: "$amountCents", balanceDelta: { $subtract: [0, "$amountCents"] }
            } }
          ]
        } },
        { $setWindowFields: {
          sortBy: { createdAt: 1, sequence: 1, _id: 1 },
          output: { balanceCents: { $sum: "$balanceDelta", window: { documents: ["unbounded", "current"] } } }
        } },
        { $sort: { createdAt: -1, sequence: -1, _id: -1 } },
        { $facet: {
          metadata: [{ $count: "total" }],
          entries: [
            { $skip: ledgerPagination.skip }, { $limit: ledgerPagination.limit },
            { $lookup: {
              from: User.collection.name,
              localField: "createdBy",
              foreignField: "_id",
              pipeline: [
                { $match: { organizationId: new mongoose.Types.ObjectId(organizationId(req)) } },
                { $project: { name: 1 } }
              ],
              as: "recordedBy"
            } },
            { $set: { recordedBy: { $ifNull: [{ $arrayElemAt: ["$recordedBy", 0] }, null] } } },
            { $project: { balanceDelta: 0, sequence: 0 } }
          ]
        } }
      ])
    ]);
    const summary = summaryRows[0] || {};
    const totalUdhaarCents = summary.totalUdhaarCents || 0;
    const totalPaidCents = summary.totalPaidCents || 0;
    const udhaarHistory = await attachProductImages(udhaar.map((record) => ({
      ...record,
      customer,
      pendingCents: record.totalCents - record.paidCents
    })), organizationId(req));
    return res.json({
      customer,
      organizationName: organization?.name || "",
      summary: {
        totalUdhaar: centsOut(totalUdhaarCents),
        totalPaid: centsOut(totalPaidCents),
        pending: centsOut(totalUdhaarCents - totalPaidCents),
        status: totalUdhaarCents <= totalPaidCents ? "paid" : totalPaidCents > 0 ? "partial" : "pending",
        recordCount: summary.count || 0,
        lastUdhaarAt: summary.lastUdhaarAt || null,
        activeUdhaarCount: summary.count || 0,
        lastTransactionAt: [summary.lastUdhaarAt, lastPayment?.createdAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null,
        totalPurchases: centsOut(totalUdhaarCents),
        saleCount: summary.count || 0,
        lastSaleAt: summary.lastUdhaarAt || null
      },
      udhaarPagination: { page: udhaarPagination.page, limit: udhaarPagination.limit, total: udhaarCount, totalPages: Math.ceil(udhaarCount / udhaarPagination.limit) },
      salesPagination: { page: udhaarPagination.page, limit: udhaarPagination.limit, total: udhaarCount, totalPages: Math.ceil(udhaarCount / udhaarPagination.limit) },
      paymentsPagination: { page: paymentsPagination.page, limit: paymentsPagination.limit, total: paymentCount, totalPages: Math.ceil(paymentCount / paymentsPagination.limit) },
      ledgerPagination: {
        page: ledgerPagination.page,
        limit: ledgerPagination.limit,
        total: ledgerResult[0]?.metadata[0]?.total || 0,
        totalPages: Math.ceil((ledgerResult[0]?.metadata[0]?.total || 0) / ledgerPagination.limit)
      },
      ledger: ledgerResult[0]?.entries || [],
      udhaar: udhaarHistory,
      sales: udhaarHistory,
      payments
    });
  } catch (error) {
    return handleControllerError(res, error, "Customer ledger lookup failed");
  }
};

const customerPayments = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid customer ID" });
    const pagination = parsePagination(req.query);
    if (!pagination) return res.status(400).json({ message: "Invalid page or limit" });
    const customer = await Customer.exists({ _id: req.params.id, organizationId: organizationId(req) });
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    const filter = { customerId: req.params.id, organizationId: organizationId(req), udhaarId: { $exists: true } };
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder || "desc";
    const sortFields = {
      createdAt: "createdAt",
      amountCents: "amountCents",
      method: "method",
      createdBy: "recordedBy.name"
    };
    if (
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      !Object.hasOwn(sortFields, sortBy) ||
      !["asc", "desc"].includes(sortOrder)
    ) {
      return res.status(400).json({ message: "Invalid payment sorting options" });
    }
    const organization = new mongoose.Types.ObjectId(organizationId(req));
    const [total, payments] = await Promise.all([
      Payment.countDocuments(filter),
      Payment.aggregate([
        {
          $match: {
            customerId: new mongoose.Types.ObjectId(req.params.id),
            organizationId: organization,
            udhaarId: { $exists: true }
          }
        },
        {
          $lookup: {
            from: User.collection.name,
            localField: "createdBy",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: organization } },
              { $project: { name: 1 } }
            ],
            as: "recordedBy"
          }
        },
        { $set: { createdBy: { $ifNull: [{ $arrayElemAt: ["$recordedBy", 0] }, null] } } },
        { $sort: { [sortFields[sortBy]]: sortOrder === "asc" ? 1 : -1, _id: 1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        { $project: { recordedBy: 0 } }
      ])
    ]);
    return res.json({ page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit), payments });
  } catch (error) {
    return handleControllerError(res, error, "Customer payment history lookup failed");
  }
};

const getUdhaarStats = async (req, res) => {
  try {
    const orgId = new mongoose.Types.ObjectId(organizationId(req));
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
    const canViewPaymentHistory = adminRoles.has(req.user.role) ||
      req.user.permissions?.includes("payments.history") ||
      req.user.permissions?.includes("udhaar.payment-history");
    const [summaryRows, todayRows, customerRows, recentUdhaar, recentPayments, trendRows, openingRows] = await Promise.all([
      Udhaar.aggregate([
        { $match: { organizationId: orgId, status: "active" } },
        { $group: { _id: null, totalCents: { $sum: "$totalCents" }, paidCents: { $sum: "$paidCents" }, count: { $sum: 1 }, pendingCount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "pending"] }, 1, 0] } }, partialCount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0] } }, paidCount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } } } }
      ]),
      Promise.all([
        Udhaar.aggregate([{ $match: { organizationId: orgId, status: "active", createdAt: { $gte: dayStart } } }, { $group: { _id: null, totalCents: { $sum: "$totalCents" }, count: { $sum: 1 } } }]),
        Payment.aggregate([{ $match: { organizationId: orgId, udhaarId: { $exists: true }, createdAt: { $gte: dayStart } } }, { $group: { _id: null, paidCents: { $sum: "$amountCents" } } }])
      ]),
      Udhaar.aggregate([
        { $match: { organizationId: orgId, status: "active", paymentStatus: { $in: ["pending", "partial"] } } },
        { $group: { _id: "$customerId", pendingCents: { $sum: { $subtract: ["$totalCents", "$paidCents"] } }, recordCount: { $sum: 1 } } },
        { $sort: { pendingCents: -1 } },
        { $facet: {
          metadata: [{ $count: "total" }],
          leaders: [
            { $limit: 10 },
            { $lookup: {
              from: Customer.collection.name,
              let: { customerId: "$_id" },
              pipeline: [
                { $match: { $expr: { $and: [
                  { $eq: ["$_id", "$$customerId"] },
                  { $eq: ["$organizationId", orgId] }
                ] } } },
                { $project: { name: 1, phone: 1 } }
              ],
              as: "customer"
            } },
            { $unwind: "$customer" }
          ]
        } }
      ]),
      Udhaar.find({ organizationId: orgId, status: "active" }).sort({ createdAt: -1 }).limit(5)
        .populate({ path: "customerId", select: "name phone", match: { organizationId: orgId } }).lean(),
      canViewPaymentHistory
        ? Payment.find({ organizationId: orgId, udhaarId: { $exists: true } }).sort({ createdAt: -1 }).limit(5)
          .populate({ path: "customerId", select: "name phone", match: { organizationId: orgId } })
          .populate({ path: "createdBy", select: "name", match: { organizationId: orgId } }).lean()
        : Promise.resolve([]),
      Promise.all([
        Udhaar.aggregate([
          { $match: { organizationId: orgId, createdAt: { $gte: trendStart } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, totalCents: { $sum: "$totalCents" } } }
        ]),
        Payment.aggregate([
          { $match: { organizationId: orgId, udhaarId: { $exists: true }, createdAt: { $gte: trendStart } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, paidCents: { $sum: "$amountCents" } } }
        ]),
        Udhaar.aggregate([
          { $match: { organizationId: orgId, status: "cancelled", cancelledAt: { $gte: trendStart } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$cancelledAt" } }, cancelledCents: { $sum: { $subtract: ["$totalCents", "$paidCents"] } } } }
        ])
      ]),
      Udhaar.aggregate([
        { $match: {
          organizationId: orgId,
          createdAt: { $lt: trendStart },
          $or: [{ status: "active" }, { status: "cancelled", cancelledAt: { $gte: trendStart } }]
        } },
        { $lookup: {
          from: Payment.collection.name,
          let: { udhaarRef: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$udhaarId", "$$udhaarRef"] },
              { $eq: ["$organizationId", orgId] },
              { $gte: ["$createdAt", trendStart] }
            ] } } },
            { $group: { _id: null, paidCents: { $sum: "$amountCents" } } }
          ],
          as: "paymentsSinceStart"
        } },
        { $set: {
          pendingAtStart: {
            $add: [
              { $subtract: ["$totalCents", "$paidCents"] },
              { $ifNull: [{ $arrayElemAt: ["$paymentsSinceStart.paidCents", 0] }, 0] }
            ]
          }
        } },
        { $group: { _id: null, pendingCents: { $sum: "$pendingAtStart" } } }
      ])
    ]);
    const summary = summaryRows[0] || {};
    const todayUdhaar = todayRows[0][0] || {};
    const todayPayments = todayRows[1][0] || {};
    const pendingCents = (summary.totalCents || 0) - (summary.paidCents || 0);
    const [dailyUdhaar, dailyPayments, dailyCancellations] = trendRows;
    const udhaarByDate = new Map(dailyUdhaar.map((row) => [row._id, row.totalCents]));
    const paymentsByDate = new Map(dailyPayments.map((row) => [row._id, row.paidCents]));
    const cancellationsByDate = new Map(dailyCancellations.map((row) => [row._id, row.cancelledCents]));
    let trendPending = openingRows[0]?.pendingCents || 0;
    const udhaarTrend = [];
    for (let day = 0; day < 30; day += 1) {
      const date = new Date(trendStart.getTime() + day * 86400000).toISOString().slice(0, 10);
      const recordCents = udhaarByDate.get(date) || 0;
      const paidCents = paymentsByDate.get(date) || 0;
      trendPending += recordCents - paidCents - (cancellationsByDate.get(date) || 0);
      udhaarTrend.push({
        date,
        udhaar: centsOut(recordCents),
        paid: centsOut(paidCents),
        pending: centsOut(trendPending)
      });
    }
    const customerSummary = customerRows[0] || { metadata: [], leaders: [] };
    return res.json({
      totals: {
        totalUdhaar: centsOut(summary.totalCents),
        totalPaid: centsOut(summary.paidCents),
        pending: centsOut(pendingCents),
        recordCount: summary.count || 0,
        customersWithBalance: customerSummary.metadata[0]?.total || 0,
        pendingCount: summary.pendingCount || 0,
        partialCount: summary.partialCount || 0,
        paidCount: summary.paidCount || 0
      },
      today: { udhaar: centsOut(todayUdhaar.totalCents), collection: centsOut(todayPayments.paidCents), count: todayUdhaar.count || 0 },
      outstandingCustomers: customerSummary.leaders.map((row) => ({
        customerId: row._id, name: row.customer.name, phone: row.customer.phone,
        outstanding: centsOut(row.pendingCents), recordCount: row.recordCount
      })),
      recentUdhaar,
      recentPayments,
      udhaarTrend
    });
  } catch (error) {
    return handleControllerError(res, error, "Udhaar statistics request failed");
  }
};

const getCustomerStats = async (req, res) => {
  try {
    const orgId = new mongoose.Types.ObjectId(organizationId(req));
    const [customerRows, udhaarRows] = await Promise.all([
      Customer.aggregate([
        { $match: { organizationId: orgId, archivedAt: null } },
        {
          $lookup: {
            from: Udhaar.collection.name,
            let: { customerRef: "$_id", organizationRef: "$organizationId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$customerId", "$$customerRef"] },
                      { $eq: ["$organizationId", "$$organizationRef"] },
                      { $eq: ["$status", "active"] }
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: null,
                  totalCents: { $sum: "$totalCents" },
                  paidCents: { $sum: "$paidCents" },
                  recordCount: { $sum: 1 }
                }
              }
            ],
            as: "activeUdhaar"
          }
        },
        {
          $set: {
            activeUdhaar: {
              $ifNull: [
                { $arrayElemAt: ["$activeUdhaar", 0] },
                { totalCents: 0, paidCents: 0, recordCount: 0 }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            totalCustomers: { $sum: 1 },
            activeUdhaarCustomers: {
              $sum: { $cond: [{ $gt: ["$activeUdhaar.recordCount", 0] }, 1, 0] }
            },
            customersWithPendingAmount: {
              $sum: {
                $cond: [
                  { $gt: [{ $subtract: ["$activeUdhaar.totalCents", "$activeUdhaar.paidCents"] }, 0] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),
      Udhaar.aggregate([
        { $match: { organizationId: orgId, status: "active" } },
        {
          $group: {
            _id: null,
            totalUdhaarCents: { $sum: "$totalCents" },
            totalCollectedCents: { $sum: "$paidCents" }
          }
        }
      ])
    ]);
    const customers = customerRows[0] || {};
    const udhaar = udhaarRows[0] || {};
    const totalCustomers = customers.totalCustomers || 0;
    const customersWithPendingAmount = customers.customersWithPendingAmount || 0;

    return res.json({
      totalCustomers,
      activeUdhaarCustomers: customers.activeUdhaarCustomers || 0,
      customersWithPendingAmount,
      totalUdhaar: centsOut(udhaar.totalUdhaarCents),
      totalCollected: centsOut(udhaar.totalCollectedCents),
      totalOutstanding: centsOut((udhaar.totalUdhaarCents || 0) - (udhaar.totalCollectedCents || 0)),
      paidOrClearCustomers: Math.max(0, totalCustomers - customersWithPendingAmount)
    });
  } catch (error) {
    return handleControllerError(res, error, "Customer statistics request failed");
  }
};

module.exports = {
  createCustomer, listCustomers, listUdhaarCustomers, getCustomer, updateCustomer, archiveCustomer, customerLedger,
  customerPayments, listUdhaar, createUdhaar, updateUdhaar, getUdhaar, cancelUdhaar, recordPayment, getUdhaarStats,
  getCustomerStats
};
