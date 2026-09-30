const express = require("express");
const { createProduct,getProducts,getProductById,updateProduct,deleteProduct,getProductStats } = require("../controllers/productController");
const adminMiddleware = require("../middleware/roleMiddleware");
const jwtMiddleware = require("../middleware/jwtMiddleware")

const router = express.Router();

// Get all products
router.get("/GetAll", getProducts);


// Get single product by ID
router.get("/GetById/:id", getProductById);

// Create a new product
router.post("/Create",jwtMiddleware,adminMiddleware, createProduct);


// Update product by ID
router.put("/Update/:id",jwtMiddleware, adminMiddleware, updateProduct);


// Delete product by ID
router.delete("/Delete/:id",jwtMiddleware, adminMiddleware, deleteProduct);

// Get Stats
router.get("/Stats", getProductStats);


module.exports = router;


