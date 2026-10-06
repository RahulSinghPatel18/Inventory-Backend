const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  image: {
    type: String,
    default: ""
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
type: mongoose.Schema.Types.ObjectId,
ref: "Category",
required: [true, "Category is required"]
},

  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true
    },

  createdBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true
}

});

productSchema.index({ organizationId: 1, category: 1 });
productSchema.index({ organizationId: 1, quantity: 1 });
productSchema.index({ organizationId: 1, price: 1 });

const Product = mongoose.model("Product", productSchema);

module.exports = Product;