const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema({
name: {
   type: String,
   required: [true, "Organization name is required"],
   trim: true,
   unique: true
   }
}, { timestamps: true });

const Organization = mongoose.model("Organization", organizationSchema);

module.exports = Organization;