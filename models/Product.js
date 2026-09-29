const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  price: {
    type: Number,
    required: true,
    min: [0, "Price cannot be negative"]
  },

  quantity: {
    type: Number,
    required: true,
    min: [0, "Quantity cannot be negative"]
  },

  category: {
    type: String,
    required: true,
    trim: true
  },
  createdBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true
}
});

const Product = mongoose.model("Product", productSchema);

module.exports = Product;