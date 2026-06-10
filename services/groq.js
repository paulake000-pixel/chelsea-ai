const { Groq } = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class GroqService {
  async shouldSearch(userMessage) {
    const systemPrompt = `You are a helpful assistant that determines if a user's query requires up-to-date information from the internet to answer accurately.

Respond with ONLY "YES" if the query requires searching the web for current information, recent events, specific facts that might change over time, or real-time data.

Respond with ONLY "NO" if the query is about general knowledge, coding help, explanations, opinions, or anything that doesn't require current/real-time information.

Query: "${userMessage}"

Response (YES or NO only):`;

    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: systemPrompt }],
        model: "llama-3.1-8b-instant",
        temperature: 0.1,
        max_tokens: 10,
      });

      const response = completion.choices[0]?.message?.content
        ?.trim()
        .toUpperCase();
      return response === "YES";
    } catch (error) {
      console.error("Error in search detection:", error);
      return false;
    }
  }

  async streamChat(messages) {
    return await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    });
  }
}

module.exports = new GroqService();
