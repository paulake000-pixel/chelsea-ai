const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/chelsea";

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  displayName: { type: String, default: "User" },
  settings: {
    customInstructions: { type: String, default: "" },
    temperature: { type: Number, default: 0.7 },
    maxTokens: { type: Number, default: 4096 },
  },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// Chat Message Schema
const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  image: { type: String, default: null },
  files: [{
    name: String,
    type: String,
    data: String,
    size: Number,
  }],
  sources: [{
    title: String,
    url: String,
    content: String,
  }],
});

// Chat Schema - uses default MongoDB ObjectId
const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, default: "New Conversation" },
  messages: [messageSchema],
}, { timestamps: true });

const Chat = mongoose.model("Chat", chatSchema);

// Guest message counters (in-memory Map keyed by IP)
const guestMessageCounts = new Map();

async function connectDatabase() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    throw error; // Let app.js handle graceful fallback
  }
}

function getGuestMessageCount(ip) {
  return guestMessageCounts.get(ip) || 0;
}

function incrementGuestMessageCount(ip) {
  const count = (guestMessageCounts.get(ip) || 0) + 1;
  guestMessageCounts.set(ip, count);
  return count;
}

function setGuestMessageCount(ip, count) {
  guestMessageCounts.set(ip, count);
  return count;
}

function resetGuestMessageCount(ip) {
  guestMessageCounts.delete(ip);
}

module.exports = {
  connectDatabase,
  User,
  Chat,
  getGuestMessageCount,
  incrementGuestMessageCount,
  setGuestMessageCount,
  resetGuestMessageCount,
};
