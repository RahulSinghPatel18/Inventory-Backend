const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");




const getCategories = async (req, res) => {
  try {
    const {
      search = "",
      name = "",
      sort = "oldest",
      page = 1,
      limit = 10
    } = req.query;
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return res.status(400).json({
        message: "Page must be a positive integer"
      });
    }

    if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
      return res.status(400).json({
        message: "Limit must be between 1 and 100"
      });
    }

    const searchTerm = String(search || name).trim();
    const filter = {
      organizationId: req.user.organizationId
    };

    if (searchTerm) {
      const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.name = { $regex: escapedSearch, $options: "i" };
    }

    const sortOptions = {
      name_asc: { name: 1 },
      name_desc: { name: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 }
    };

    if (!Object.hasOwn(sortOptions, sort)) {
      return res.status(400).json({
        message: "Invalid category sort order"
      });
    }

    const totalCategories = await Category.countDocuments(filter);
    const totalPages = Math.ceil(totalCategories / limitNumber);
    const categories = await Category.find(filter)
      .sort(sortOptions[sort])
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .populate("createdBy", "name email");

    res.json({
      message: "Categories fetched successfully",
      page: pageNumber,
      limit: limitNumber,
      totalCategories,
      totalPages,
      hasNextPage: pageNumber < totalPages,
      hasPreviousPage: pageNumber > 1,
      categories
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch categories",
      error: error.message
    });
  }
};



const createCategory = async (req, res) => {
             try {
             
             const { name } = req.body;
             
             if (!name) {
               return res.status(400).json({
                 message: "Category name is required"
               });
             }
             
              const categoryName = name.trim().toLowerCase();

              const existingCategory = await Category.findOne({
                name: categoryName,
                organizationId: req.user.organizationId
              });
              
              if (existingCategory) {
                return res.status(400).json({
                  message: "Category already exists"
                });
              }
              


             const category = await Category.create({
               name: categoryName,
               organizationId: req.user.organizationId,
               createdBy: req.user.userId
             });
             console.log("Category Org:", req.user.organizationId);
             res.status(201).json({
               message: "Category created successfully",
               category
             });
             
             } catch (error) {
             res.status(500).json({
             message: "Category creation failed",
             error: error.message
             });
             }
             };
             





    const updateCategory = async (req, res) => {
                  try {
                  
                  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                    return res.status(400).json({
                      message: "Invalid category ID"
                    });
                  }
                  
                  const { name } = req.body;
                  
                  if (!name) {
                    return res.status(400).json({
                      message: "Category name is required"
                    });
                  }
                  
                  const categoryName = name.trim().toLowerCase();
                  
                  const existingCategory = await Category.findOne({
                    name: categoryName,
                    organizationId: req.user.organizationId,
                    _id: { $ne: req.params.id }
                  });
                  
                  if (existingCategory) {
                    return res.status(400).json({
                      message: "Category already exists"
                    });
                  }
                  
                  const category = await Category.findOneAndUpdate(
                    {
                      _id: req.params.id,
                      organizationId: req.user.organizationId
                    },
                    {
                      name: categoryName
                    },
                    {
                      new: true,
                      runValidators: true
                    }
                  );
                  
                  if (!category) {
                    return res.status(404).json({
                      message: "Category not found"
                    });
                  }
                  
                  res.json({
                    message: "Category updated successfully",
                    category
                  });
                  
                  } catch (error) {
                  res.status(500).json({
                  message: "Failed to update category",
                  error: error.message
                  });
                  }
                  };
                  
            







          const getCategoryById = async (req, res) => {
                    try {
                    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                    return res.status(400).json({
                    message: "Invalid category ID"
                    });
                    }
                    
                    const category = await Category.findOne({
                      _id: req.params.id,
                      organizationId: req.user.organizationId
                    }).populate("createdBy", "name email");
                    
                    if (!category) {
                      return res.status(404).json({
                        message: "Category not found"
                      });
                    }
                    
                    res.json({
                      message: "Category fetched successfully",
                      category
                    });
                    
                    } catch (error) {
                    res.status(500).json({
                    message: "Failed to fetch category",
                    error: error.message
                    });
                    }
                    }; 
            







                  const deleteCategory = async (req, res) => {
                try {
                
                
                if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                  return res.status(400).json({
                    message: "Invalid category ID"
                  });
                }
                
                const category = await Category.findOne({
                  _id: req.params.id,
                  organizationId: req.user.organizationId
                });
                
                if (!category) {
                  return res.status(404).json({
                    message: "Category not found"
                  });
                }
                
                const products = await Product.countDocuments({
                  category: req.params.id,
                  organizationId: req.user.organizationId
                });
                
                if (products > 0) {
                  return res.status(400).json({
                    message: "Category cannot be deleted because products are using it"
                  });
                }
                
                await Category.findOneAndDelete({
                  _id: req.params.id,
                  organizationId: req.user.organizationId
                });
                
                res.json({
                  message: "Category deleted successfully",
                  category
                });
                
                
                } catch (error) {
                res.status(500).json({
                message: "Failed to delete category",
                error: error.message
                });
                }
                };



const getCategoryStats = async (req, res) => {
try {
const organizationId = req.user.organizationId;

const stats = await Category.aggregate([
  {
    $match: {
      organizationId: new mongoose.Types.ObjectId(organizationId)
    }
  },
  {
    $lookup: {
      from: "products",
      let: { categoryId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$category", "$$categoryId"] },
                { $eq: ["$organizationId", new mongoose.Types.ObjectId(organizationId)] }
              ]
            }
          }
        }
      ],
      as: "products"
    }
  },
  {
    $project: {
      _id: 1,
      categoryName: "$name",
      totalProducts: { $size: "$products" },
      totalStock: { $sum: "$products.quantity" },
      totalInventoryValue: {
        $sum: {
          $map: {
            input: "$products",
            as: "product",
            in: {
              $multiply: ["$$product.price", "$$product.quantity"]
            }
          }
        }
      },
      lowStockProducts: {
        $size: {
          $filter: {
            input: "$products",
            as: "product",
            cond: {
              $and: [
                { $gt: ["$$product.quantity", 0] },
                { $lte: ["$$product.quantity", 5] }
              ]
            }
          }
        }
      },
      outOfStockProducts: {
        $size: {
          $filter: {
            input: "$products",
            as: "product",
            cond: {
              $eq: ["$$product.quantity", 0]
            }
          }
        }
      }
    }
  }
]);

res.status(200).json({
  message: "Category statistics fetched successfully",
  categories: stats
});

} catch (error) {
res.status(500).json({
message: "Failed to get category statistics",
error: error.message
});
}
};


  


 module.exports = { createCategory, getCategories,updateCategory, deleteCategory,getCategoryById, getCategoryStats };