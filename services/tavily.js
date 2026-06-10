const { tavily } = require("@tavily/core");

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

class TavilyService {
  constructor() {
    this.client = null;
    this.ddg = null;
    if (TAVILY_API_KEY) {
      this.client = tavily({ apiKey: TAVILY_API_KEY });
      console.log("✅ Tavily client initialized");
    } else {
      console.warn("⚠️ TAVILY_API_KEY not set - search disabled");
    }
    // DuckDuckGo fallback
    try {
      this.ddg = require("duckduckgo-search");
    } catch {}
  }

  async searchAndSummarize(query) {
    // Try Tavily first
    if (this.client) {
      try {
        console.log(`[Tavily] Searching: "${query}"`);
        const response = await this.client.search(query, {
          searchDepth: "basic",
          maxResults: 5,
          includeAnswer: true,
        });
        const sources = (response.results || []).map((r) => ({
          title: r.title || "",
          url: r.url || "",
          content: r.content?.slice(0, 500) || "",
        }));
        console.log(`[Tavily] Found ${sources.length} results`);
        return { sources, summary: response.answer || "" };
      } catch (error) {
        const msg = (error.message || "").replace(/<[^>]*>/g, "").slice(0, 100);
        console.warn("[Tavily] Failed, trying DuckDuckGo fallback...");
      }
    }

    // Fallback: DuckDuckGo
    if (this.ddg) {
      try {
        console.log(`[DDG] Searching: "${query}"`);
        const results = [];
        const stream = this.ddg.search(query, { safeSearch: "off" });
        for await (const r of stream) {
          results.push({
            title: r.title || "",
            url: r.url || r.href || "",
            content: (r.description || r.body || "").slice(0, 500),
          });
          if (results.length >= 5) break;
        }
        console.log(`[DDG] Found ${results.length} results`);
        return { sources: results, summary: "" };
      } catch (e) {
        console.warn("[DDG] Fallback also failed:", e.message);
      }
    }

    return { sources: [], summary: "" };
  }
}

module.exports = new TavilyService();
