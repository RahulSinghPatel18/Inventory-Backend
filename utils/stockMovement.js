const Product = require("../models/Product");
const StockHistory = require("../models/StockHistory");

const moveStock = async ({
  items,
  type,
  organizationId,
  userId,
  session,
  sourceType,
  sourceId
}) => {
  for (const item of items) {
    const quantityFilter = type === "out"
      ? { $gte: item.quantity }
      : { $lte: Number.MAX_SAFE_INTEGER - item.quantity };
    const product = await Product.findOneAndUpdate(
      { _id: item.productId, organizationId, quantity: quantityFilter },
      { $inc: { quantity: type === "out" ? -item.quantity : item.quantity } },
      { new: true, session, runValidators: true }
    );
    if (!product) {
      throw Object.assign(
        new Error(type === "out" ? "Insufficient stock" : "Stock quantity exceeds the supported range"),
        { status: 409 }
      );
    }
    await StockHistory.create([{
      productId: product._id,
      type,
      quantity: item.quantity,
      organizationId,
      createdBy: userId,
      ...(sourceType && sourceId ? { sourceType, sourceId } : {})
    }], { session });
  }
};

module.exports = moveStock;
