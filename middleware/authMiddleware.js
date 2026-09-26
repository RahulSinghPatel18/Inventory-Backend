const authMiddleware = (req, res, next) => {

  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      message: "API key is required"
    });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      message: "Invalid API key"
    });
  }

  next();
};

module.exports = authMiddleware;