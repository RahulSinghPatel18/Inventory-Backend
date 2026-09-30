const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Organization = require("../models/Organization");

const registerUser = async (req, res) => {
  try {

    const { name, email, password, organizationName } = req.body;

    if (!name || !email || !password || !organizationName) {
      return res.status(400).json({
        message: "Name, email, password and organizationName are required"
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists"
      });
    }



let organization = await Organization.findOne({
  name: organizationName.trim()
});

if (!organization) {
  organization = await Organization.create({
    name: organizationName.trim()
  });
}

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      organizationId: organization._id,
      role : "admin"
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId
      }
    });

  } catch (error) {

    res.status(500).json({
      message: "Registration failed",
      error: error.message
    });

  }
};




const loginUser = async (req, res) => {
  try {

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign({
      userId: user._id ,
      role: user.role,
      organizationId: user.organizationId
    },
      
      process.env.JWT_SECRET, { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token
    });

  } catch (error) {

    res.status(500).json({
      message: "Login failed",
      error: error.message
    });

  }
};





const getProfile = async (req, res) => {
  try {

    const user = await User.findById(req.user.userId).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.json({
      message: "Profile fetched successfully",
      user
    });

  } catch (error) {

    res.status(500).json({
      message: "Failed to fetch profile",
      error: error.message
    });

  }
};


const updateProfile = async (req, res) => {
try {


const { name, profileImage } = req.body;

const user = await User.findById(req.user.userId);

if (!user) {
  return res.status(404).json({
    message: "User not found"
  });
}

if (name) {
  user.name = name;
}

if (profileImage !== undefined) {
  user.profileImage = profileImage;
}

await user.save();

res.json({
  message: "Profile updated successfully",
  user: {
    id: user._id,
    name: user.name,
    email: user.email,
    profileImage: user.profileImage
  }
});


} catch (error) {


res.status(500).json({
  message: "Failed to update profile",
  error: error.message
});


}
};



module.exports = { registerUser, loginUser, getProfile, updateProfile };