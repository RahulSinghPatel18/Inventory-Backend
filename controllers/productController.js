const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");
const handleControllerError = require("../utils/controllerError");
const {
  escapeRegex,
  isNonEmptyString,
  isValidObjectId,
  parsePagination
} = require("../utils/requestValidation");

const parseNonNegativeNumber = (value) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const parseQuantity = (value) => {
  const quantity = parseNonNegativeNumber(value);
  return Number.isInteger(quantity) ? quantity : null;
};

const createProduct = async (req, res) => {
  try {
    const { name, price, quantity, category } = req.body || {};
    const parsedPrice = parseNonNegativeNumber(price);
    const parsedQuantity = parseQuantity(quantity);
    if (!isNonEmptyString(name) || parsedPrice === null || parsedQuantity === null) {
      return res.status(400).json({
        message: "Enter a product name, valid price and whole-number quantity"
      });
    }
    if (!isValidObjectId(category)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const categoryExists = await Category.exists({
      _id: category,
      organizationId: req.user.organizationId
    });
    if (!categoryExists) {
      return res.status(404).json({ message: "Category not found" });
    }

    const product = await Product.create({
      name: name.trim(),
      price: parsedPrice,
      quantity: parsedQuantity,
      category,
      organizationId: req.user.organizationId,
      createdBy: req.user.userId
    });
    return res.status(201).json({
      message: "Product created successfully",
      product
    });
  } catch (error) {
    return handleControllerError(res, error, "Product creation failed");
  }
};

const getProducts = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) {
      return res.status(400).json({
        message: "Page and limit must be valid positive integers (limit up to 100)"
      });
    }

    const { category, name, sort } = req.query;
    if (category && !isValidObjectId(category)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }
    if (name !== undefined && (
      typeof name !== "string" || name.length > 100
    )) {
      return res.status(400).json({ message: "Search must be at most 100 characters" });
    }
    const sortOptions = {
      price_asc: { price: 1 },
      price_desc: { price: -1 }
    };
    if (
      sort !== undefined &&
      sort !== "" &&
      (typeof sort !== "string" || !Object.hasOwn(sortOptions, sort))
    ) {
      return res.status(400).json({ message: "Invalid product sort order" });
    }

    const filter = { organizationId: req.user.organizationId };
    if (category) filter.category = category;
    if (name?.trim()) {
      filter.name = { $regex: escapeRegex(name.trim()), $options: "i" };
    }

    const [totalProducts, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort(sortOptions[sort] || {})
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate("category", "name")
        .populate("createdBy", "name email role")
        .lean()
    ]);
    const totalPages = Math.ceil(totalProducts / pagination.limit);
    return res.json({
      message: "Products fetched successfully",
      page: pagination.page,
      limit: pagination.limit,
      totalProducts,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
      products
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch products");
  }
};

const getProductById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await Product.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    }).populate("createdBy", "name email role").lean();

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    return res.json({ message: "Product fetched successfully", product });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch product");
  }
};

const updateProduct = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const { name, price, quantity, category } = req.body || {};
    const update = {};
    if (name !== undefined) {
      if (!isNonEmptyString(name)) {
        return res.status(400).json({ message: "Product name is required" });
      }
      update.name = name.trim();
    }
    if (price !== undefined) {
      const value = parseNonNegativeNumber(price);
      if (value === null) return res.status(400).json({ message: "Price cannot be negative" });
      update.price = value;
    }
    if (quantity !== undefined) {
      const value = parseQuantity(quantity);
      if (value === null) {
        return res.status(400).json({ message: "Quantity must be a whole number of 0 or more" });
      }
      update.quantity = value;
    }
    if (category !== undefined) {
      if (!isValidObjectId(category)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      if (!await Category.exists({
        _id: category,
        organizationId: req.user.organizationId
      })) {
        return res.status(404).json({ message: "Category not found" });
      }
      update.category = category;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        message: "At least one field is required to update"
      });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { $set: update },
      { returnDocument: "after", runValidators: true }
    )
      .populate("category", "name")
      .populate("createdBy", "name email role");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    return res.json({ message: "Product updated successfully", product });
  } catch (error) {
    return handleControllerError(res, error, "Failed to update product");
  }
};

const deleteProduct = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.user.organizationId
    });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    return res.json({ message: "Product deleted successfully" });
  } catch (error) {
    return handleControllerError(res, error, "Failed to delete product");
  }
};

const getProductStats = async (req, res) => {
  try {
    const [stats] = await Product.aggregate([
      { $match: { organizationId: new mongoose.Types.ObjectId(req.user.organizationId) } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalStock: { $sum: "$quantity" },
          totalInventoryValue: { $sum: { $multiply: ["$price", "$quantity"] } },
          lowStockProducts: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ["$quantity", 0] }, { $lte: ["$quantity", 5] }] },
                1,
                0
              ]
            }
          },
          outOfStockProducts: {
            $sum: { $cond: [{ $eq: ["$quantity", 0] }, 1, 0] }
          }
        }
      }
    ]);

    return res.status(200).json({
      totalProducts: stats?.totalProducts || 0,
      totalStock: stats?.totalStock || 0,
      lowStockProducts: stats?.lowStockProducts || 0,
      outOfStockProducts: stats?.outOfStockProducts || 0,
      totalInventoryValue: stats?.totalInventoryValue || 0
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to get product statistics");
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductStats
};
