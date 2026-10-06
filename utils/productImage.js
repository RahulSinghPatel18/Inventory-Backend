const MAX_PRODUCT_IMAGE_SIZE_BYTES = 300 * 1024;

const hasExpectedSignature = (mimeType, image) => {
  if (mimeType === "jpeg") {
    return image.length >= 3 &&
      image[0] === 0xff &&
      image[1] === 0xd8 &&
      image[2] === 0xff;
  }
  if (mimeType === "png") {
    return image.length >= 8 &&
      image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return mimeType === "webp" &&
    image.length >= 12 &&
    image.toString("ascii", 0, 4) === "RIFF" &&
    image.toString("ascii", 8, 12) === "WEBP";
};

const isValidProductImage = (value) => {
  if (value === "") return true;
  if (typeof value !== "string") return false;

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;

  const [, mimeType, encodedImage] = match;
  const image = Buffer.from(encodedImage, "base64");
  return image.length > 0 &&
    image.length <= MAX_PRODUCT_IMAGE_SIZE_BYTES &&
    image.toString("base64") === encodedImage &&
    hasExpectedSignature(mimeType, image);
};

module.exports = {
  isValidProductImage,
  MAX_PRODUCT_IMAGE_SIZE_BYTES
};
