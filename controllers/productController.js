const Product = require("../models/Product");
const mongoose = require("mongoose");
// POST /products
// Create a new product
const createProduct = async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, createdBy: req.user.userId });
    
 

    res.status(201).json({
      message: "Product created",
      product: product,
    });
  } catch (error) {
    res.status(400).json({
      message: "Product creation failed",
      error: error.message
    });
  }
};


// GET /products
// Get all products
const getProducts = async (req, res) => {
  try {
    // filter products by category if category query parameter(req.query) is provided
    const {category, name, sort, page = 1, limit = 4} = req.query;
// validation for page and limit query parameters
      const pageNumber = Number(page);
    const limitNumber = Number(limit);

    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1
    ) {
      return res.status(400).json({
        message: "Page must be a positive integer"
      });
    }

    if (
      !Number.isInteger(limitNumber) ||
      limitNumber < 1 ||
      limitNumber > 100
    ) {
      return res.status(400).json({
        message: "Limit must be between 1 and 100"
      });
    }

    const filter = {};
    if (category){ filter.category = category; }
    if (name){
      // $regex partial search, $options case-insensitive search
      filter.name = { $regex: name, $options: "i" };  }
      
// pagination lagayi: --------------
    const skip = (pageNumber -1) * limitNumber;

// Total Products ------------------
    const totalProducts = await Product.countDocuments(filter);
    
// query lgayi: ------------------
    let query = Product.find(filter).skip(skip).limit(limitNumber);

// Sorting lagayi: ----------------
    if (sort === "price_asc") {
      query = query.sort({ price: 1 });
    }

    if (sort === "price_desc") {
      query = query.sort({ price: -1 });
    }

    const products = await query.populate("createdBy", "name email role"); // Populate createdBy field with username, email, and role
    // Total Pages 
    const totalPages = Math.ceil(totalProducts / limit);

    res.json({
      message: "Products fetched successfully",
      page: Number(pageNumber),
      limit: Number(limitNumber),
      totalProducts, 
      totalPages,
      hasNextPage: Number(pageNumber) < totalPages,
      hasPreviousPage: Number(pageNumber) > 1,
      products
    });
 
    
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch products",
      error: error.message
    });
  }
};


// GET /products/:id
// Get single product by ID
const getProductById = async (req, res) => {
  try {

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const product = await Product.findById(req.params.id).populate("createdBy", "name email role");

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json({
      message: "Product fetched successfully",
      product
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch product",
      error: error.message
    });
  }
};

// PUT /products/:id
// Update product by ID
const updateProduct = async (req, res) => {
  try {

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
     { new: true,
     runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json({
      message: "Product updated successfully",
      product
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to update product",
      error: error.message
    });
  }
};

// DELETE /products/:id
// Delete product by ID
const deleteProduct = async (req, res) => {
  try {

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid product ID"
      });
    }

    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json({
      message: "Product deleted successfully",
      product
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to delete product",
      error: error.message
    });
  }
};



const getProductStats = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();

    const stockResult = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalStock: { $sum: "$quantity" },
          totalInventoryValue: {
          $sum: { $multiply: ["$price", "$quantity"] }
          }
        }
      }
    ]);

    const lowStockProducts = await Product.countDocuments({
      quantity: { $gt: 0, $lte: 5 }
    });

    const outOfStockProducts = await Product.countDocuments({
      quantity: 0
    });

    res.status(200).json({
      totalProducts,
      totalStock: stockResult[0]?.totalStock || 0,
      lowStockProducts,
      outOfStockProducts,
      totalInventoryValue: stockResult[0]?.totalInventoryValue || 0,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to get product statistics",
      error: error.message
    });
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


