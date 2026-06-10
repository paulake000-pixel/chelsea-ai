const OpenAI = require("openai");

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.warn("WARNING: DEEPSEEK_API_KEY not set");
}

const deepseek = new OpenAI({
  apiKey: DEEPSEEK_API_KEY || "sk-dummy",
  baseURL: "https://api.deepseek.com",
});

class DeepSeekService {
  constructor() {
    this.client = deepseek;
    this.searchModel = "deepseek-chat";
    this.chatModel = "deepseek-v4-flash";
    this.proModel = "deepseek-v4-pro";
    this.visionModel = "deepseek-v4-flash";
    this.summarizerModel = "deepseek-v4-flash";
  }

  /**
   * Ask the LLM if search is needed AND generate optimized search queries.
   * Returns { needsSearch: boolean, queries: string[] }
   */
  async shouldSearch(conversationHistory, latestMessage) {
    const systemPrompt = `You are a search strategist. Your job:
1. Decide if the user's query needs up-to-date internet information
2. If YES, generate up to 5 optimized search queries that will find the best results

Output format:
NO
or
YES | query one | query two | query three | query four | query five

RULES:
- Output YES if: current events, news, politics, prices, weather, facts about real people/companies, recent data, specific information that might change
- Output NO if: coding, math, casual chat, creative writing, follow-ups using existing context
- When YES: generate up to 5 specific, targeted search queries. Include relevant keywords, names, dates. Make each query different — cover different angles.
- For website/brand/company requests: include the company name, "official website", "brand colors", "logo", "design guidelines", "founded year", "about page"
- For political topics: include the politician/party name, specific policy area, recent timeframe
- Queries should be SHORT (under 80 chars each), specific, and likely to return useful results

Query: "${latestMessage}"

Your response:`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.chatModel,
        messages: [
          ...conversationHistory.slice(-4),
          { role: "user", content: systemPrompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      const response = completion.choices[0]?.message?.content?.trim() || "NO";
      console.log(`[DeepSeek] searchDecision("${latestMessage.slice(0, 60)}") => ${response.slice(0, 80)}`);

      if (response.toUpperCase().startsWith("YES")) {
        const parts = response.split("|").map(s => s.trim());
        // First part is YES, rest are queries
        const queries = parts.slice(1).filter(q => q.length > 2 && !q.startsWith("YES"));
        if (queries.length === 0) {
          // Fallback: use the user's message as the query
          queries.push(latestMessage.slice(0, 200));
        }
        return { needsSearch: true, queries };
      }
      return { needsSearch: false, queries: [] };
    } catch (error) {
      console.error("[DeepSeek] Search detection error:", error.message);
      return { needsSearch: false, queries: [] };
    }
  }

  /**
   * Stream a chat completion
   */
  async streamChat(messages, modelOverride) {
    return await this.client.chat.completions.create({
      model: modelOverride || this.chatModel,
      messages,
      temperature: 0.7,
      stream: true,
    });
  }

  /**
   * DeepSeek's API only supports text content — no image_url vision.
   * We provide context so the model responds naturally about the received image.
   */
  async analyzeImage(base64Image, prompt = "Describe this image in detail.") {
    // DeepSeek API does NOT support image_url content type (only text).
    // Provide guidance so the model handles the image gracefully.
    const imageSizeKB = Math.round((base64Image?.length || 0) / 1024);
    return `[The user has shared an image with you (${imageSizeKB}KB). You cannot view images directly. Acknowledge receiving the image warmly, then politely ask the user to describe what they'd like help with — what's in the image, or what they want you to do with it. Be natural and helpful. The user's message was: "${prompt}"]`;
  }

  /**
   * Process uploaded files and generate a summary/context from them
   */
  async processFiles(files, userMessage) {
    if (!files || files.length === 0) return "";

    // Text-based extensions that we can decode and analyze
    const textExtensions = ["md", "txt", "py", "js", "ts", "jsx", "tsx", "html", "css", "json", "xml", "yaml", "yml", "csv", "sql", "sh", "bat", "ps1", "rb", "php", "java", "cpp", "c", "h", "go", "rs", "swift", "kt", "scala", "r", "lua"];

    let fileContents = "";
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      fileContents += `\n--- File: ${file.name} (${Math.round(file.size / 1024)}KB) ---\n`;
      if (textExtensions.includes(ext)) {
        try {
          // Decode base64 content
          const decoded = Buffer.from(file.data, "base64").toString("utf-8");
          fileContents += decoded.slice(0, 3000); // Limit to first 3000 chars per file
          if (decoded.length > 3000) fileContents += "\n... [truncated]";
        } catch {
          fileContents += "[Binary file - content not displayable]\n";
        }
      } else {
        fileContents += `[${file.type} file - ${Math.round(file.size / 1024)}KB]\n`;
      }
    }

    const prompt = `The user uploaded the following files and says: "${userMessage || 'Please analyze these files.'}"

File contents:
${fileContents}

Provide a helpful response about these files, analyzing their content where available.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.chatModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 2048,
      });
      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      console.error("[DeepSeek] File processing error:", error.message);
      return "";
    }
  }
}

module.exports = new DeepSeekService();
