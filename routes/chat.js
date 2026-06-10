const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();
const deepseekService = require("../services/deepseek");
const tavilyService = require("../services/tavily");
const { Chat, User, incrementGuestMessageCount, setGuestMessageCount } = require("../services/database");

// Generate a fresh MongoDB ObjectId for a new chat
router.get("/id", (req, res) => {
  res.json({ chatId: new mongoose.Types.ObjectId().toString() });
});

// Helper to save chat to DB (uses upsert for reliability)
async function saveChatToDB(user, chatId, title, messages) {
  if (!user || !chatId) {
    console.warn("[Chat] Skipping save — no user or chatId:", { hasUser: !!user, chatId });
    return;
  }
  try {
    await Chat.findOneAndUpdate(
      { _id: chatId, userId: user._id },
      {
        $set: {
          userId: user._id,
          messages: messages || [],
          title: title || "New Conversation",
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
    console.log("[Chat] Saved:", chatId, "| messages:", messages?.length || 0);
  } catch (dbError) {
    console.error("[Chat] DB save error:", dbError.message);
  }
}

// Chat endpoint
router.post("/", async (req, res) => {
  const { message, conversationHistory = [], image, files, chatId: clientChatId, selectedModel, guestCount, customInstructions } = req.body;

  const model = selectedModel && selectedModel !== "auto" ? selectedModel : "deepseek-v4-flash";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    // Check message limit for guest users
    const user = req.user;
    const userName = user?.displayName?.split(" ")[0] || null;

    if (!user) {
      const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
      // Use the client-reported count to persist across refresh
      const clientCount = typeof guestCount === "number" ? guestCount + 1 : incrementGuestMessageCount(ip);
      // Sync server count with client
      setGuestMessageCount(ip, clientCount);

      if (clientCount > 5) {
        res.write(`data: ${JSON.stringify({ type: "auth_required" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        return;
      }
    }

    let searchResults = [];
    let searchSummary = "";
    let fullResponse = "";

    // Handle image
    if (image) {
      res.write(`data: ${JSON.stringify({ type: "status", content: "analyzing_image" })}\n\n`);
      const imageAnalysis = await deepseekService.analyzeImage(image, message || "Describe this image.");
      const userGreeting = userName ? `\n\nThe user you're speaking to is ${userName}. Address them by name naturally.` : "";
      const customInstr = customInstructions ? `\n\nUser's custom instructions: ${customInstructions}` : "";
      const systemPrompt = `You are Chelsea, a helpful AI assistant. Be concise.${userGreeting}${customInstr}\n\nThe user shared an image. ${imageAnalysis}`;

      const messages = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.slice(-12),
        { role: "user", content: message || "What can you tell me about this image?" },
      ];

      res.write(`data: ${JSON.stringify({ type: "status", content: "generating" })}\n\n`);
      const stream = await deepseekService.streamChat(messages, model);
      for await (const chunk of stream) {
        const c = chunk.choices[0]?.delta?.content || "";
        if (c) { fullResponse += c; res.write(`data: ${JSON.stringify({ type: "chunk", content: c })}\n\n`); }
      }

      if (user && clientChatId) {
        await saveChatToDB(user, clientChatId, message?.slice(0, 40) || "Image Analysis", [
          ...conversationHistory.map(m => ({ role: m.role, content: m.content, timestamp: new Date() })),
          { role: "user", content: message || "[Image sent]", timestamp: new Date(), image },
          { role: "assistant", content: fullResponse, timestamp: new Date() },
        ]);
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    // Handle files
    if (files && files.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "status", content: "processing_files" })}\n\n`);
      const fileContext = await deepseekService.processFiles(files, message);
      const userGreeting = userName ? `\n\nThe user you're speaking to is ${userName}. Address them by name naturally.` : "";
      const customInstr = customInstructions ? `\n\nUser's custom instructions: ${customInstructions}` : "";
      const systemPrompt = `You are Chelsea, a helpful AI assistant.${userGreeting}${customInstr}\n\nFile context: ${fileContext}`;

      const messages = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message || "Please analyze these files." },
      ];

      res.write(`data: ${JSON.stringify({ type: "status", content: "generating" })}\n\n`);
      const stream = await deepseekService.streamChat(messages, model);
      for await (const chunk of stream) {
        const c = chunk.choices[0]?.delta?.content || "";
        if (c) { fullResponse += c; res.write(`data: ${JSON.stringify({ type: "chunk", content: c })}\n\n`); }
      }

      if (user && clientChatId) {
        await saveChatToDB(user, clientChatId, message?.slice(0, 40) || "File Analysis", [
          ...conversationHistory.map(m => ({ role: m.role, content: m.content, timestamp: new Date() })),
          { role: "user", content: message || "[Files uploaded]", timestamp: new Date(), files },
          { role: "assistant", content: fullResponse, timestamp: new Date() },
        ]);
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    // Step 1: Ask LLM if search needed + generate optimized queries
      res.write(`data: ${JSON.stringify({ type: "status", content: "thinking" })}\n\n`);
    const searchDecision = await deepseekService.shouldSearch(conversationHistory, message);

    // Step 2: If search needed, search with each generated query
    if (searchDecision.needsSearch && searchDecision.queries.length > 0) {
      res.write(`data: ${JSON.stringify({ type: "status", content: "searching" })}\n\n`);
      for (const query of searchDecision.queries) {
        const result = await tavilyService.searchAndSummarize(query);
        if (result.sources.length > 0) {
          searchResults.push(...result.sources);
          if (result.summary) searchSummary += (searchSummary ? "\n\n" : "") + result.summary;
        }
      }
      // Dedupe sources by URL
      const seen = new Set();
      searchResults = searchResults.filter(s => { const k = s.url; if (seen.has(k)) return false; seen.add(k); return true; });
      if (searchResults.length > 0) {
        res.write(`data: ${JSON.stringify({ type: "sources", sources: searchResults })}\n\n`);
      }
    }

    // Step 3: Prepare messages with full context + live memory + user identity + custom instructions
    let contextBlock = "";
    if (searchResults.length > 0) {
      const top = searchResults.slice(0, 5);
      contextBlock = `\n\n## Web Results\n${top.map((r, i) => `[${r.title}](${r.url})`).join("\n")}\n${searchSummary ? `Summary: ${searchSummary.slice(0, 500)}` : ""}`;
    }

    let memoryContext = "";
    if (conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-10);
      memoryContext = `\n\n## Live Memory\nRecent messages:\n${recent.map(m => `- **${m.role === "user" ? "User" : "You"}**: ${(m.content || "").slice(0, 300)}`).join("\n")}`;
    }

    const userGreeting = userName ? `\n\n## User Identity\nThe user you're speaking to is named **${userName}**. Address them by name naturally in conversation.` : "";
    const customInstr = customInstructions ? `\n\n## Custom Instructions\n${customInstructions}` : "";

    const systemPrompt = `You are Chelsea, a brilliant AI assistant with complete memory. Be concise. Use markdown. Cite web sources. Address user by name.${userGreeting}

## FILE OUTPUT RULES
You CAN generate downloadable files (PDF, DOCX, PPTX, XLSX, CSV, JSON, TXT, MD, HTML). Download buttons appear above your response. NEVER say "I can't generate files" or "copy/paste into Word" or "here's a template." NEVER use [bracketed placeholders] — fill ALL fields with realistic details.

- PDF/DOCX/DOCUMENTS: Write complete markdown with # headings, bullet lists, tables. Fill every detail — real names, dates, numbers. Finished product, not a template.
- HTML/WEBPAGES: Output complete \`\`\`html block with ALL CSS inline in <style> and ALL JS in <script>. Use exact colors requested. No lorem ipsum. No placeholders. Write the FULL page — header, sections, footer, everything.
- SPREADSHEETS: Real data with 10-15 rows minimum.
- PRESENTATIONS: # for title slide, ## for each slide.
- NEVER output email drafts unless explicitly asked.
- NEVER preface with research notes or planning — go straight to the document/code.${customInstr}${contextBlock}${memoryContext}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-12),
      { role: "user", content: message },
    ];

    // Step 4: Stream response
    res.write(`data: ${JSON.stringify({ type: "status", content: "generating" })}\n\n`);
    const stream = await deepseekService.streamChat(messages, model);
    for await (const chunk of stream) {
      const c = chunk.choices[0]?.delta?.content || "";
      if (c) { fullResponse += c; res.write(`data: ${JSON.stringify({ type: "chunk", content: c })}\n\n`); }
    }

    // Step 5: Save to DB
    if (user && clientChatId) {
      await saveChatToDB(user, clientChatId, (message || "").slice(0, 40) + ((message || "").length > 40 ? "..." : ""), [
        ...conversationHistory.map(m => ({ role: m.role, content: m.content, timestamp: new Date() })),
        { role: "user", content: message || "", timestamp: new Date() },
        { role: "assistant", content: fullResponse, timestamp: new Date(), sources: searchResults.length > 0 ? searchResults : undefined },
      ]);
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error in chat endpoint:", error);
    res.write(`data: ${JSON.stringify({ type: "error", content: error.message })}\n\n`);
    res.end();
  }
});

// Save chat
router.post("/save", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const { chatId, title, messages } = req.body;
  if (!chatId) return res.status(400).json({ error: "chatId required" });
  await saveChatToDB(user, chatId, title, messages);
  res.json({ chatId });
});

// Update user settings
router.put("/settings", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const { customInstructions, temperature, maxTokens } = req.body;
  try {
    await User.findByIdAndUpdate(user._id, {
      "settings.customInstructions": customInstructions || "",
      "settings.temperature": temperature ?? 0.7,
      "settings.maxTokens": maxTokens ?? 4096,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user settings
router.get("/settings", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  res.json({ settings: user.settings || { customInstructions: "", temperature: 0.7, maxTokens: 4096 } });
});

// Get all user chats (list)
router.get("/list", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  try {
    const chats = await Chat.find({ userId: user._id }).select("_id title createdAt updatedAt").sort({ updatedAt: -1 }).lean();
    res.json({ chats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single chat
router.get("/chats/:chatId", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, userId: user._id }).lean();
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json({ chat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename chat
router.patch("/chats/:chatId", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
  try {
    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.chatId, userId: user._id },
      { title: title.trim(), updatedAt: new Date() },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json({ success: true, chat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete chat
router.delete("/chats/:chatId", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required" });
  try {
    await Chat.deleteOne({ _id: req.params.chatId, userId: user._id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
