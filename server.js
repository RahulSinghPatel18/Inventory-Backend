require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const mongoose = require("mongoose");

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error("JWT_SECRET and MONGO_URI must be configured");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

start().catch(() => {
  console.error("Server failed to start");
  process.exit(1);
});
