const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, match: [/^[0-9]{10}$/, "Phone number must contain exactly 10 digits"] },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  archivedAt: { type: Date, default: null }
}, { timestamps: true });

customerSchema.index({ organizationId: 1, createdAt: -1 });
customerSchema.index({ organizationId: 1, name: 1 });
customerSchema.index({ organizationId: 1, phone: 1 });
module.exports = mongoose.model("Customer", customerSchema);
