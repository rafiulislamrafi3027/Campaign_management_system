require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");

const app = express();

app.use(cors());
// Proof files are sent as base64 inside JSON, so allow bigger bodies (5 files × 5 MB)
app.use(express.json({ limit: "35mb" }));

// Basic security headers for every answer (NFR 25)
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});

// Every API answer gets short-lived signed links for uploaded files (NFR 25)
const { signUploadLinks, serveUpload } = require("./services/fileAccess");
app.use("/api", signUploadLinks);

// API routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/campaigns", require("./routes/campaignRoutes"));
app.use("/api/applications", require("./routes/applicationRoutes"));
app.use("/api/tasks", require("./routes/taskRoutes"));
app.use("/api/alerts", require("./routes/alertRoutes"));
app.use("/api/expenses", require("./routes/expenseRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/certificates", require("./routes/certificateRoutes"));

// Uploaded files are private: they open only with a valid signed link (NFR 25)
app.get("/uploads/:folder/:file", serveUpload);
app.use("/uploads", (req, res) => res.status(404).send("Not found"));

// Serve the HTML/CSS/JS frontend from the "client" folder
app.use(express.static(path.join(__dirname, "..", "client")));

// Unknown API route
app.use("/api", (req, res) => res.status(404).json({ message: "API route not found" }));

// Errors such as a request body that is too large
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ message: "The files are too large. Each file must be under 5 MB." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid request data" });
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
});
