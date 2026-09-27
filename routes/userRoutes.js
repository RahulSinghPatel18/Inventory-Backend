const express = require("express");
const { registerUser,loginUser,getProfile } = require("../controllers/userController");
const jwtMiddleware = require("../middleware/jwtMiddleware");

const router = express.Router();


router.post("/Register", registerUser);
router.post("/Login", loginUser);
router.get("/Profile", jwtMiddleware, getProfile);


module.exports = router;