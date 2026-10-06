const mongoose = require("mongoose");

const saleLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPriceCents: { type: Number, required: true, min: 0 },
  lineTotalCents: { type: Number, required: true, min: 0 }
}, { _id: false });

const saleSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
  customerName: { type: String },
  items: { type: [saleLineSchema], required: true },
  totalCents: { type: Number, required: true, min: 0 },
  paidCents: { type: Number, required: true, min: 0, default: 0 },
  paymentMethod: { type: String, enum: ["cash", "online", "other"], default: "cash" },
  verification: {
    type: String,
    enum: ["otp", "manual", "none"],
    required: true
  },
  status: { type: String, enum: ["completed", "cancelled"], default: "completed" },
  cancelledAt: { type: Date },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  manuallyVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

saleSchema.index({ organizationId: 1, createdAt: -1 });
saleSchema.index({ organizationId: 1, customerId: 1, createdAt: -1 });
saleSchema.index({ organizationId: 1, paymentMethod: 1, createdAt: -1 });
module.exports = mongoose.model("Sale", saleSchema);
