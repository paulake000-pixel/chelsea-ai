const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { connectDatabase } = require("./services/database");
const { authenticateToken } = require("./middleware/auth");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Auth middleware (attaches req.user if token is valid)
app.use(authenticateToken);

// Serve static files from the dist folder
app.use(express.static(path.join(__dirname, "dist")));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/export", require("./routes/export"));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Catch-all: serve index.html for any unknown routes (must be last)
// Uses Express 5 path-to-regexp v8 named wildcard syntax
app.get("/{*path}", (req, res) => {
  // Skip API routes that weren't matched — let them 404 naturally
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 4000;

// Try to connect to MongoDB, but start server either way
connectDatabase()
  .then(() => {
    console.log("Starting server with database...");
  })
  .catch((err) => {
    console.warn("MongoDB not available - running without database:", err.message);
    console.warn("Authentication and chat persistence will be disabled.");
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
