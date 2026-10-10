const Notification = require("../models/Notification");

const createStockTransitionNotification = async ({
  product,
  previousQuantity,
  organizationId,
  userId,
  session
}) => {
  let type;
  let title;
  let message;

  if (previousQuantity > 0 && product.quantity === 0) {
    type = "stock-out";
    title = "Product out of stock";
    message = `${product.name} has no units remaining.`;
  } else if (
    product.quantity > 0 &&
    product.quantity <= 5 &&
    (previousQuantity > 5 || previousQuantity === 0)
  ) {
    type = "stock-low";
    title = "Low stock alert";
    message = `${product.name} has ${product.quantity} units remaining.`;
  }

  if (!type) return null;
  const [notification] = await Notification.create([{
    organizationId,
    createdBy: userId,
    type,
    title,
    message,
    entityType: "product",
    entityId: product._id
  }], { session });
  return notification;
};

module.exports = createStockTransitionNotification;
