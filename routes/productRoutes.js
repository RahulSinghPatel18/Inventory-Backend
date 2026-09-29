const express = require("express");
const { createProduct,getProducts,getProductById,updateProduct,deleteProduct } = require("../controllers/productController");
const adminMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

// Get all products
router.get("/GetAll", getProducts);


// Get single product by ID
router.get("/GetById/:id", getProductById);

// Create a new product
router.post("/Create",adminMiddleware, createProduct);


// Update product by ID
router.put("/Update/:id", adminMiddleware, updateProduct);


// Delete product by ID
router.delete("/Delete/:id", adminMiddleware, deleteProduct);


module.exports = router;


