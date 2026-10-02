const mongoose = require("mongoose");

const stockHistorySchema = new mongoose.Schema({
          productId: {
             type: mongoose.Schema.Types.ObjectId,
             ref: "Product",
             required: true
             },

          type: {
              type: String,
              enum: ["in", "out"],
              required: true
              },

          quantity: {
               type: Number,
               required: true,
               min: 1
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
          }, { timestamps: true });

stockHistorySchema.index({ organizationId: 1, createdAt: -1 });
stockHistorySchema.index({ organizationId: 1, productId: 1, createdAt: -1 });



const StockHistory = mongoose.model("StockHistory", stockHistorySchema);

module.exports = StockHistory;