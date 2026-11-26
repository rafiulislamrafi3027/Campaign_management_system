// Creates the first Admin account. Run once:  npm run seed:admin
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const User = require("./models/User");

(async () => {
  await connectDB();

  const email = (process.env.ADMIN_EMAIL || "admin@campaignhub.com").toLowerCase();
  const exists = await User.findOne({ email });

  if (exists) {
    console.log("Admin already exists:", email);
  } else {
    await User.create({
      name: process.env.ADMIN_NAME || "Admin",
      email,
      password: await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 10),
      role: "admin",
      status: "approved",
    });
    console.log("Admin created:", email);
  }

  await mongoose.disconnect();
})();
