const express = require("express");
const { registerUser,loginUser,getProfile,updateProfile } = require("../controllers/userController");
const jwtMiddleware = require("../middleware/jwtMiddleware");
const { loginRateLimit, registerRateLimit } = require("../middleware/authRateLimit");

const router = express.Router();


router.post("/Register", registerRateLimit, registerUser);
router.post("/Login", loginRateLimit, loginUser);
router.get("/Profile", jwtMiddleware, getProfile);
router.put("/UpdateProfile", jwtMiddleware, updateProfile);


module.exports = router;