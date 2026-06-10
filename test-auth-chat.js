require("dotenv").config();
const mongoose = require("mongoose");
const { generateToken } = require("./middleware/auth");

async function test() {
  try {
    // Connect to DB
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chelsea");
    const { User } = require("./services/database");
    
    // Find any user
    const user = await User.findOne({});
    if (!user) {
      console.log("❌ No users found. Need to sign up first.");
      await mongoose.disconnect();
      return;
    }
    console.log("✅ Found user:", user.email);

    // Generate a valid token
    const token = generateToken(user._id);
    console.log("✅ Generated token length:", token.length);

    // Test auth endpoint
    const resp1 = await fetch("http://localhost:4000/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data1 = await resp1.json();
    console.log("✅ Auth check:", resp1.status, data1.user?.email || "FAILED");

    // Test chat endpoint with auth
    const resp2 = await fetch("http://localhost:4000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        message: "say hello back",
        selectedModel: "auto",
        chatId: Date.now().toString()
      })
    });

    const reader = resp2.body?.getReader();
    if (!reader) {
      console.log("❌ No response body");
      await mongoose.disconnect();
      return;
    }

    const decoder = new TextDecoder();
    let fullText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value);
    }

    console.log("✅ Chat SSE response:");
    console.log(fullText.slice(0, 1000));
    
    // Check if auth_required was returned
    if (fullText.includes("auth_required")) {
      console.log("❌ BUG: auth_required returned even with valid token!");
    } else if (fullText.includes("error")) {
      console.log("❌ Server returned an error");
    } else if (fullText.includes("chunk")) {
      console.log("✅ Chat works! Got streaming chunks");
    } else if (fullText.includes("done")) {
      console.log("✅ Chat response received");
    }

    await mongoose.disconnect();
    console.log("✅ Done");
  } catch (e) {
    console.error("❌ Error:", e.message);
  }
}

test();
