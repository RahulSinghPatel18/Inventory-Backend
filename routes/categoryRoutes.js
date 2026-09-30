const express = require("express");
const {createCategory,getCategories,updateCategory,getCategoryById,deleteCategory } = require("../controllers/categoryController");

const router = express.Router();

router.post("/Create", createCategory);
router.get("/GetAll", getCategories);
router.get("/GetById", getCategoryById);
router.put("/Update/:id", updateCategory);
router.delete("/Delete/:id",deleteCategory )

module.exports = router;