const express = require("express");
const router = express.Router();
const groqService = require("../services/groq");
const tavilyService = require("../services/tavily");

router.post("/", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    // Step 1: Detect if search is needed
    const needsSearch = await groqService.shouldSearch(message);

    let searchResults = [];

    // Step 2: If search needed, perform it and notify client
    if (needsSearch) {
      res.write(
        `data: ${JSON.stringify({ type: "status", content: "searching" })}\n\n`,
      );

      searchResults = await tavilyService.search(message);

      res.write(
        `data: ${JSON.stringify({
          type: "sources",
          sources: searchResults,
        })}\n\n`,
      );
    }

    // Step 3: Prepare messages for Groq
    const systemPrompt = `You are Chelsea, a helpful AI assistant. Be concise and helpful in your responses. Use markdown formatting for better readability (headings, lists, code blocks, bold, etc.).

When generating emails, use professional formatting:
- Start with "To:" and "Subject:" on separate lines
- Use ## or ### for section headings (not ASCII art)
- Use bullet points (-) or numbered lists for organized content
- Use **bold** for emphasis, not ALL CAPS or decorative lines
- Keep the layout clean and professional
- Structure the email with clear sections if needed

${
  searchResults.length > 0
    ? `\n\nUse the following search results to help answer the user's query:\n${searchResults.map((r) => `- ${r.title}: ${r.content}`).join("\n")}`
    : ""
}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: message },
    ];

    // Step 4: Stream response from Groq
    res.write(
      `data: ${JSON.stringify({ type: "status", content: "generating" })}\n\n`,
    );

    const stream = await groqService.streamChat(messages);

    // Step 5: Stream chunks to client
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
      }
    }

    // Send end signal
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error in chat endpoint:", error);
    res.write(
      `data: ${JSON.stringify({ type: "error", content: error.message })}\n\n`,
    );
    res.end();
  }
});

module.exports = router;
