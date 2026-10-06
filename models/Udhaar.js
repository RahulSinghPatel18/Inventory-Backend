const mongoose = require("mongoose");

const udhaarItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPriceCents: { type: Number, required: true, min: 0 },
  lineTotalCents: { type: Number, required: true, min: 0 }
}, { _id: false });

const udhaarSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  items: { type: [udhaarItemSchema], default: [] },
  totalCents: { type: Number, required: true, min: 1 },
  paidCents: { type: Number, required: true, min: 0, default: 0 },
  paymentStatus: { type: String, enum: ["pending", "partial", "paid"], required: true },
  status: { type: String, enum: ["active", "cancelled"], default: "active" },
  paymentMethod: { type: String, enum: ["cash", "online", "other"], default: "cash" },
  cancelledAt: { type: Date },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

udhaarSchema.index({ organizationId: 1, createdAt: -1 });
udhaarSchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });
udhaarSchema.index({ organizationId: 1, paymentStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Udhaar", udhaarSchema);
