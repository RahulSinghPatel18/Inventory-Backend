const loggerMiddleware = (req, res, next) => {
  console.info(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
};

module.exports = loggerMiddleware;