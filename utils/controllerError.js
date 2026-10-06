const handleControllerError = (res, error, message) => {
  if (error?.code === 11000) {
    return res.status(409).json({ message: "A record with these details already exists" });
  }

  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return res.status(400).json({ message: "Invalid request data" });
  }

  console.error(`${message} (${error?.name || "Error"})`);
  return res.status(500).json({ message });
};

module.exports = handleControllerError;
