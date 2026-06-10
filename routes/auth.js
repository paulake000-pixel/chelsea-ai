const express = require("express");
const bcrypt = require("bcryptjs");
const { User, getGuestMessageCount, resetGuestMessageCount } = require("../services/database");
const { generateToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

// Signup
router.post("/signup", async (req, res) => {
  const { email, password, displayName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email: email.toLowerCase(),
      password: hashedPassword,
      displayName: displayName || email.split("@")[0],
    });

    await user.save();

    const token = generateToken(user._id);

    // Reset guest message count on signup
    const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    if (ip) resetGuestMessageCount(ip);

    res.status(201).json({
      token,
      user: { id: user._id, email: user.email, displayName: user.displayName },
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(500).json({ error: "Failed to create account" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken(user._id);

    // Reset guest message count on login
    const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    if (ip) resetGuestMessageCount(ip);

    res.json({
      token,
      user: { id: user._id, email: user.email, displayName: user.displayName },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Failed to login" });
  }
});

// Get current user
router.get("/me", requireAuth, async (req, res) => {
  res.json({
    user: { id: req.user._id, email: req.user.email, displayName: req.user.displayName },
  });
});

// Check guest message count
router.get("/guest-count", (req, res) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const count = getGuestMessageCount(ip);
  res.json({ count, limit: 5 });
});

module.exports = router;
