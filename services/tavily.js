const { tavily } = require("@tavily/core");

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

class TavilyService {
  async search(query) {
    try {
      const response = await tavilyClient.search(query, {
        searchDepth: "basic",
        maxResults: 5,
      });

      return response.results.map((result) => ({
        title: result.title,
        content: result.content,
        url: result.url,
      }));
    } catch (error) {
      console.error("Error in Tavily search:", error);
      return [];
    }
  }
}

module.exports = new TavilyService();
