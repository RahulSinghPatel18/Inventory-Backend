const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");



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
             
            const getCategories = async (req, res) => {
            try {
            
            const categories = await Category.find({
              organizationId: req.user.organizationId
            }).populate("createdBy", "name email");
            
            res.json({
              message: "Categories fetched successfully",
              categories
            });
            
            } catch (error) {
            res.status(500).json({
            message: "Failed to fetch categories",
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







 module.exports = { createCategory, getCategories,updateCategory, deleteCategory,getCategoryById };