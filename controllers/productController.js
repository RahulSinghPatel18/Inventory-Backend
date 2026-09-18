const Product = require("../models/Product");
const mongoose = require("mongoose");
// POST /products
// Create a new product
const createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);

    res.status(201).json({
      message: "Product created",
      product: product
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
    const {category, name, sort, page = 1, limit =5} = req.query;
    const filter = {};
    if (category){ filter.category = category; }
    if (name){
      // $regex partial search, $options case-insensitive search
      filter.name = { $regex: name, $options: "i" };  }
      
// pagination lagayi: --------------
    const skip = (page -1) * limit;

// Total Products ------------------
    const totalProducts = await Product.countDocuments(filter);
    
// query lgayi: ------------------
    let query = Product.find(filter).skip(skip).limit(limit);

// Sorting lagayi: ----------------
    if (sort === "price_asc") {
      query = query.sort({ price: 1 });
    }

    if (sort === "price_desc") {
      query = query.sort({ price: -1 });
    }

    const products = await query;
    // Total Pages 
    const totalPages = Math.ceil(totalProducts / limit);

    res.json({
      message: "Products fetched successfully",
      page: Number(page),
      limit: Number(limit),
      totalProducts, 
      totalPages,
      hasNextPage: Number(page) < totalPages,
      hasPreviousPage: Number(page) > 1,
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

    const product = await Product.findById(req.params.id);

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

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct
};


