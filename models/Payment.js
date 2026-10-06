const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: "Sale" },
  udhaarId: { type: mongoose.Schema.Types.ObjectId, ref: "Udhaar" },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
  amountCents: { type: Number, required: true, min: 1 },
  method: { type: String, trim: true, maxlength: 40, default: "other" },
  note: { type: String, trim: true, maxlength: 500, default: "" },
  verification: { type: String, enum: ["otp", "manual", "none"], required: true },
  manuallyVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

paymentSchema.pre("validate", function validateReference() {
  if (Boolean(this.saleId) === Boolean(this.udhaarId)) {
    throw new Error("Payment must be linked to exactly one sale or Udhaar record");
  }
});

paymentSchema.index({ organizationId:  1, customerId: 1, createdAt: -1 });
paymentSchema.index({ organizationId: 1, saleId: 1, createdAt: -1 });
paymentSchema.index({ organizationId: 1, udhaarId: 1, createdAt: -1 });
module.exports = mongoose.model("Payment", paymentSchema);
