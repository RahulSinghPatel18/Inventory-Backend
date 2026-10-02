const express = require("express");
const {createCategory,getCategories,updateCategory,getCategoryById,deleteCategory,getCategoryStats } = require("../controllers/categoryController");

const router = express.Router();

router.post("/Create", createCategory);
router.get("/GetAll", getCategories);
router.get("/GetById/:id", getCategoryById);
router.put("/Update/:id", updateCategory);
router.delete("/Delete/:id",deleteCategory );
router.get("/Stats", getCategoryStats);
module.exports = router;