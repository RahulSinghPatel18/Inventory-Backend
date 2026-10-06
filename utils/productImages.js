const Product = require("../models/Product");

const attachProductImages = async (records, organizationId) => {
  const productIds = [...new Set((records || [])
    .flatMap((record) => record.items || [])
    .map((item) => item.productId?._id || item.productId)
    .filter(Boolean)
    .map(String))];

  if (!productIds.length) return records;

  const products = await Product.find({
    _id: { $in: productIds },
    organizationId
  }).select("_id image").lean();
  const images = new Map(products.map((product) => [String(product._id), product.image]));

  return records.map((record) => ({
    ...record,
    items: (record.items || []).map((item) => {
      const productId = item.productId?._id || item.productId;
      return {
        ...item,
        productImage: images.get(String(productId)) || ""
      };
    })
  }));
};

module.exports = attachProductImages;
