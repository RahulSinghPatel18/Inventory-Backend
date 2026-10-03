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

const categorySortOptions = {
  name_asc: { name: 1 },
  name_desc: { name: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 }
};

const getCategories = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) {
      return res.status(400).json({
        message: "Page and limit must be valid positive integers (limit up to 100)"
      });
    }

    const { search = "", name = "", sort = "oldest" } = req.query;
    const searchTerm = search || name;
    if (typeof searchTerm !== "string" || searchTerm.length > 100) {
      return res.status(400).json({ message: "Search must be at most 100 characters" });
    }
    if (typeof sort !== "string" || !Object.hasOwn(categorySortOptions, sort)) {
      return res.status(400).json({ message: "Invalid category sort order" });
    }

    const filter = { organizationId: req.user.organizationId };
    if (searchTerm.trim()) {
      filter.name = { $regex: escapeRegex(searchTerm.trim()), $options: "i" };
    }

    const [totalCategories, categories] = await Promise.all([
      Category.countDocuments(filter),
      Category.find(filter)
        .sort(categorySortOptions[sort])
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate("createdBy", "name email")
        .lean()
    ]);
    const totalPages = Math.ceil(totalCategories / pagination.limit);
    return res.json({
      message: "Categories fetched successfully",
      page: pagination.page,
      limit: pagination.limit,
      totalCategories,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
      categories
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch categories");
  }
};

const createCategory = async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const categoryName = name.trim().toLowerCase();
    if (await Category.exists({
      name: categoryName,
      organizationId: req.user.organizationId
    })) {
      return res.status(409).json({ message: "Category already exists" });
    }

    const category = await Category.create({
      name: categoryName,
      organizationId: req.user.organizationId,
      createdBy: req.user.userId
    });
    return res.status(201).json({
      message: "Category created successfully",
      category
    });
  } catch (error) {
    return handleControllerError(res, error, "Category creation failed");
  }
};

const updateCategory = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }
    const { name } = req.body || {};
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const categoryName = name.trim().toLowerCase();
    if (await Category.exists({
      name: categoryName,
      organizationId: req.user.organizationId,
      _id: { $ne: req.params.id }
    })) {
      return res.status(409).json({ message: "Category already exists" });
    }

    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { $set: { name: categoryName } },
      { returnDocument: "after", runValidators: true }
    );
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    return res.json({ message: "Category updated successfully", category });
  } catch (error) {
    return handleControllerError(res, error, "Failed to update category");
  }
};

const getCategoryById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const category = await Category.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId
    }).populate("createdBy", "name email").lean();
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    return res.json({ message: "Category fetched successfully", category });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch category");
  }
};

const deleteCategory = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const filter = {
      _id: req.params.id,
      organizationId: req.user.organizationId
    };
    if (!await Category.exists(filter)) {
      return res.status(404).json({ message: "Category not found" });
    }
    if (await Product.exists({
      category: req.params.id,
      organizationId: req.user.organizationId
    })) {
      return res.status(400).json({
        message: "Category cannot be deleted because products are using it"
      });
    }

    const category = await Category.findOneAndDelete(filter);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    return res.json({ message: "Category deleted successfully", category });
  } catch (error) {
    return handleControllerError(res, error, "Failed to delete category");
  }
};

const getCategoryStats = async (req, res) => {
  try {
    const organizationId = new mongoose.Types.ObjectId(req.user.organizationId);
    const categories = await Category.aggregate([
      { $match: { organizationId } },
      {
        $lookup: {
          from: Product.collection.name,
          localField: "_id",
          foreignField: "category",
          pipeline: [
            { $match: { organizationId } },
            {
              $group: {
                _id: null,
                totalProducts: { $sum: 1 },
                totalStock: { $sum: "$quantity" },
                totalInventoryValue: {
                  $sum: { $multiply: ["$price", "$quantity"] }
                },
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
          ],
          as: "productStats"
        }
      },
      {
        $project: {
          _id: 1,
          categoryName: "$name",
          totalProducts: {
            $ifNull: [{ $arrayElemAt: ["$productStats.totalProducts", 0] }, 0]
          },
          totalStock: {
            $ifNull: [{ $arrayElemAt: ["$productStats.totalStock", 0] }, 0]
          },
          totalInventoryValue: {
            $ifNull: [{ $arrayElemAt: ["$productStats.totalInventoryValue", 0] }, 0]
          },
          lowStockProducts: {
            $ifNull: [{ $arrayElemAt: ["$productStats.lowStockProducts", 0] }, 0]
          },
          outOfStockProducts: {
            $ifNull: [{ $arrayElemAt: ["$productStats.outOfStockProducts", 0] }, 0]
          }
        }
      }
    ]);

    return res.status(200).json({
      message: "Category statistics fetched successfully",
      categories
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to get category statistics");
  }
};

module.exports = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  getCategoryById,
  getCategoryStats
};
