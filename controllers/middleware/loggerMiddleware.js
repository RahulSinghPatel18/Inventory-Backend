const loggerMiddleware = (req, res, next) => {

  console.log("Request received");
  console.log("Method:", req.method);
  console.log("URL:", req.originalUrl);
  console.log("Time:", new Date().toLocaleString());


//   Agar next() hata doge to request middleware me ruk jayegi aur response nahi milega.
  next();
};

module.exports = loggerMiddleware;