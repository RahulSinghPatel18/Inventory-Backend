const mongoose = require("mongoose");
const Product = require("../models/Product");
const StockHistory = require("../models/StockHistory");
const handleControllerError = require("../utils/controllerError");
const {
  escapeRegex,
  isValidObjectId,
  parsePagination
} = require("../utils/requestValidation");

const parseQuantity = (value) => (
  (typeof value === "number" || (typeof value === "string" && value.trim())) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0
    ? Number(value)
    : null
);

const parseDate = (value, endOfDay = false) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
};

const recordMovement = async (req, res, type) => {
  try {
    const { productId, quantity: requestedQuantity } = req.body || {};
    const quantity = parseQuantity(requestedQuantity);
    if (!isValidObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    if (quantity === null) {
      return res.status(400).json({ message: "Quantity must be a whole number greater than 0" });
    }

    const session = await mongoose.startSession();
    let movement;
    try {
      await session.withTransaction(async () => {
        const filter = {
          _id: productId,
          organizationId: req.user.organizationId
        };
        if (type === "out") filter.quantity = { $gte: quantity };
        if (type === "in") {
          filter.quantity = { $lte: Number.MAX_SAFE_INTEGER - quantity };
        }

        const product = await Product.findOneAndUpdate(
          filter,
          { $inc: { quantity: type === "in" ? quantity : -quantity } },
          { returnDocument: "after", runValidators: true, session }
        );

        if (!product) {
          const exists = await Product.exists({
            _id: productId,
            organizationId: req.user.organizationId
          }).session(session);
          movement = exists
            ? {
              status: 400,
              message: type === "out"
                ? "Insufficient stock"
                : "Resulting stock exceeds the supported range"
            }
            : { status: 404, message: "Product not found" };
          return;
        }

        const [history] = await StockHistory.create([{
          productId: product._id,
          type,
          quantity,
          organizationId: req.user.organizationId,
          createdBy: req.user.userId
        }], { session });
        movement = { product, history };
      });
    } finally {
      await session.endSession();
    }

    if (movement.status) {
      return res.status(movement.status).json({ message: movement.message });
    }

    if (type === "in") {
      return res.status(200).json({
        message: "Stock added successfully",
        product: movement.product,
        history: movement.history
      });
    }
    return res.status(200).json({
      message: "Stock removed successfully",
      productId: movement.product._id,
      currentStock: movement.product.quantity,
      history: {
        type: movement.history.type,
        quantity: movement.history.quantity
      }
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      type === "in" ? "Stock in failed" : "Stock out failed"
    );
  }
};

const stockIn = (req, res) => recordMovement(req, res, "in");
const stockOut = (req, res) => recordMovement(req, res, "out");

const getStockHistory = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) {
      return res.status(400).json({
        message: "Page and limit must be valid positive integers (limit up to 100)"
      });
    }

    const {
      productId,
      type,
      startDate,
      endDate,
      search = "",
      sort
    } = req.query;
    if (productId !== undefined && !isValidObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    if (typeof search !== "string" || search.length > 100) {
      return res.status(400).json({ message: "Search must be at most 100 characters" });
    }
    if (type !== undefined && !["in", "out"].includes(type)) {
      return res.status(400).json({ message: "Type must be either in or out" });
    }
    const legacySorts = {
      newest: ["createdAt", "desc"],
      oldest: ["createdAt", "asc"],
      quantity_asc: ["quantity", "asc"],
      quantity_desc: ["quantity", "desc"]
    };
    if (sort !== undefined && (typeof sort !== "string" || !Object.hasOwn(legacySorts, sort))) {
      return res.status(400).json({ message: "Invalid stock history sort order" });
    }
    const [sortBy = "createdAt", sortOrder = "desc"] = sort === undefined
      ? [req.query.sortBy, req.query.sortOrder]
      : legacySorts[sort];
    const sortFields = {
      createdAt: "createdAt",
      product: "product.name",
      type: "type",
      quantity: "quantity",
      createdBy: "recordedBy.name"
    };
    if (
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      !Object.hasOwn(sortFields, sortBy) ||
      !["asc", "desc"].includes(sortOrder)
    ) {
      return res.status(400).json({ message: "Invalid stock history sorting options" });
    }

    const organization = new mongoose.Types.ObjectId(req.user.organizationId);
    const filter = { organizationId: organization };
    if (productId) filter.productId = new mongoose.Types.ObjectId(productId);
    if (search.trim()) {
      const matchingProductIds = await Product.distinct("_id", {
        organizationId: req.user.organizationId,
        name: { $regex: escapeRegex(search.trim()), $options: "i" }
      });
      if (filter.productId) {
        filter.productId = matchingProductIds.some(
          (id) => String(id) === String(productId)
        ) ? new mongoose.Types.ObjectId(productId) : { $in: [] };
      } else {
        filter.productId = { $in: matchingProductIds };
      }
    }
    if (type) filter.type = type;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = parseDate(startDate);
        if (!start) return res.status(400).json({ message: "Invalid start date" });
        filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = parseDate(endDate, true);
        if (!end) return res.status(400).json({ message: "Invalid end date" });
        filter.createdAt.$lte = end;
      }
      if (filter.createdAt.$gte && filter.createdAt.$lte &&
          filter.createdAt.$gte > filter.createdAt.$lte) {
        return res.status(400).json({ message: "End date must be on or after the start date" });
      }
    }

    const direction = sortOrder === "asc" ? 1 : -1;
    const historyQuery = ["product", "createdBy"].includes(sortBy)
      ? StockHistory.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: Product.collection.name,
            localField: "productId",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: organization } },
              { $project: { name: 1, price: 1, category: 1, image: 1 } }
            ],
            as: "productDetails"
          }
        },
        {
          $lookup: {
            from: "users",
            localField: "createdBy",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: organization } },
              { $project: { name: 1, email: 1 } }
            ],
            as: "creatorDetails"
          }
        },
        {
          $set: {
            product: { $ifNull: [{ $arrayElemAt: ["$productDetails", 0] }, null] },
            recordedBy: { $ifNull: [{ $arrayElemAt: ["$creatorDetails", 0] }, null] }
          }
        },
        { $sort: { [sortFields[sortBy]]: direction, _id: 1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        {
          $set: {
            productId: "$product",
            createdBy: "$recordedBy"
          }
        },
        { $project: { productDetails: 0, creatorDetails: 0, product: 0, recordedBy: 0 } }
      ])
      : StockHistory.find(filter)
        .sort({ [sortFields[sortBy]]: direction, _id: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate("productId", "name price category image")
        .populate("createdBy", "name email")
        .lean();
    const [totalHistory, history] = await Promise.all([
      StockHistory.countDocuments(filter),
      historyQuery
    ]);
    const totalPages = Math.ceil(totalHistory / pagination.limit);
    return res.json({
      message: "Stock history fetched successfully",
      page: pagination.page,
      limit: pagination.limit,
      totalHistory,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
      history
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch stock history");
  }
};

const getPaginatedStockProducts = async (req, res, quantityFilter, message) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) {
      return res.status(400).json({
        message: "Page and limit must be valid positive integers (limit up to 100)"
      });
    }

    const sortBy = req.query.sortBy || "name";
    const sortOrder = req.query.sortOrder || "asc";
    const sortFields = {
      name: "name",
      price: "price",
      quantity: "quantity",
      totalValue: "totalValue"
    };
    if (
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      !Object.hasOwn(sortFields, sortBy) ||
      !["asc", "desc"].includes(sortOrder)
    ) {
      return res.status(400).json({ message: "Invalid stock product sorting options" });
    }
    const filter = {
      organizationId: new mongoose.Types.ObjectId(req.user.organizationId),
      quantity: quantityFilter
    };
    const [count, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.aggregate([
        { $match: filter },
        { $addFields: { totalValue: { $multiply: ["$price", "$quantity"] } } },
        { $sort: { [sortFields[sortBy]]: sortOrder === "asc" ? 1 : -1, _id: 1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit }
      ])
    ]);
    const totalPages = Math.ceil(count / pagination.limit);
    return res.json({
      message,
      count,
      page: pagination.page,
      limit: pagination.limit,
      totalProducts: count,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
      products
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch stock alerts");
  }
};

const getLowStock = (req, res) => getPaginatedStockProducts(
  req,
  res,
  { $gt: 0, $lte: 5 },
  "Low stock products fetched successfully"
);

const getOutOfStock = (req, res) => getPaginatedStockProducts(
  req,
  res,
  0,
  "Out of stock products fetched successfully"
);

const getStockSummary = async (req, res) => {
  try {
    const { productId } = req.query;
    if (!isValidObjectId(productId)) {
      return res.status(400).json({
        message: productId ? "Invalid product ID" : "Product ID is required"
      });
    }

    const productObjectId = new mongoose.Types.ObjectId(productId);
    const organizationObjectId = new mongoose.Types.ObjectId(req.user.organizationId);
    const [productResult, stockDataResult] = await Promise.allSettled([
      Product.findOne({
        _id: productId,
        organizationId: req.user.organizationId
      }).select("name quantity").lean(),
      StockHistory.aggregate([
        {
          $match: {
            productId: productObjectId,
            organizationId: organizationObjectId
          }
        },
        {
          $group: {
            _id: "$productId",
            totalStockIn: {
              $sum: { $cond: [{ $eq: ["$type", "in"] }, "$quantity", 0] }
            },
            totalStockOut: {
              $sum: { $cond: [{ $eq: ["$type", "out"] }, "$quantity", 0] }
            }
          }
        }
      ])
    ]);
    if (productResult.status === "rejected") throw productResult.reason;
    const product = productResult.value;
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (stockDataResult.status === "rejected") throw stockDataResult.reason;
    const [stockData] = stockDataResult.value;

    return res.status(200).json({
      message: "Stock summary fetched successfully",
      product: {
        id: product._id,
        name: product.name,
        currentStock: product.quantity
      },
      summary: {
        totalStockIn: stockData?.totalStockIn || 0,
        totalStockOut: stockData?.totalStockOut || 0
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch stock summary");
  }
};

module.exports = {
  stockIn,
  stockOut,
  getStockHistory,
  getLowStock,
  getOutOfStock,
  getStockSummary
};
