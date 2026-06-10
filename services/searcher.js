const axios = require("axios");
const cheerio = require("cheerio");
const groqService = require("./groq");

const MAX_LINKS_TO_CLICK = 3;

// Common browser headers to avoid blocking
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

class SearcherService {
  /**
   * Search Bing for results using axios + cheerio
   * Bing is less aggressive with bot detection than Google
   */
  async searchWeb(query) {
    try {
      console.log(`[Searcher] Searching Bing for: "${query}"`);

      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH&count=10`;
      console.log(`[Searcher] Fetching URL: ${url.slice(0, 100)}`);
      const resp = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout: 15000,
        decompress: true,
      });

      console.log(`[Searcher] Response status: ${resp.status}, body length: ${resp.data.length}`);

      const $ = cheerio.load(resp.data);
      const results = [];

      console.log(`[Searcher] .b_algo count: ${$(".b_algo").length}`);

      // Bing uses .b_algo for organic search results
      $(".b_algo").each((i, el) => {
        const title = $(el).find("h2 a").text().trim();
        const url = $(el).find("h2 a").attr("href") || "";
        const snippet = $(el).find(".b_caption p, .b_lineclamp2, .b_caption .b_snippet").text().trim();

        if (title && url && !url.includes("bing.com")) {
          results.push({ title, url, snippet });
        }
      });

      // Fallback: try alternative Bing selectors
      if (results.length === 0) {
        $("li.b_algo, .b_algo").each((i, el) => {
          const title = $(el).find("a").first().text().trim();
          const url = $(el).find("a").first().attr("href") || "";
          const snippet = $(el).find("p, .b_snippet, .b_caption p").first().text().trim();
          if (title && url && !url.includes("bing.com")) {
            results.push({ title, url, snippet });
          }
        });
      }

      console.log(`[Searcher] Found ${results.length} results`);
      return results.slice(0, 8);
    } catch (error) {
      console.error("[Searcher] Search error:", error.message);
      return [];
    }
  }

  /**
   * Scrape a single page's text content using axios + cheerio
   */
  async scrapePage(url) {
    try {
      console.log(`[Searcher] Scraping: ${url}`);
      const resp = await axios.get(url, {
        headers: PAGE_HEADERS,
        timeout: 15000,
        decompress: true,
        maxRedirects: 5,
      });

      const $ = cheerio.load(resp.data);

      // Remove unwanted elements
      $(
        "script, style, nav, footer, header, aside, noscript, iframe, " +
          ".sidebar, .nav, .footer, .header, .menu, .ad, .advertisement, " +
          ".cookie-banner, .cookie-consent, .cookie-notice, .popup, .modal",
      ).remove();

      // Try main content areas first
      let text = "";
      const selectors = [
        "article",
        "main",
        "[role='main']",
        ".post-content",
        ".entry-content",
        ".content",
        ".article-body",
        "#content",
        ".mw-parser-output",
        ".post",
        ".article",
        ".prose",
      ];

      for (const sel of selectors) {
        const el = $(sel);
        if (el.length) {
          text = el.text();
          if (text.trim().length > 200) break; // Found substantial content
        }
      }

      if (!text || text.trim().length < 100) {
        text = $("body").text();
      }

      text = text.replace(/\s+/g, " ").trim().slice(0, 8000);
      return text;
    } catch (error) {
      console.error(`[Searcher] Error scraping ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Summarize scraped content using Groq
   */
  async summarizeContent(content, originalQuery) {
    const prompt = `You are a research summarizer. Summarize the following web content found for the query: "${originalQuery}"

Extract the key facts, data, and relevant information. Be concise but comprehensive. Ignore irrelevant or promotional content.

Content to summarize:
${content}

Provide a clear, well-structured summary of the key findings.`;

    try {
      const completion = await groqService.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a precise research summarizer. Summarize web content accurately and concisely.",
          },
          { role: "user", content: prompt },
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.3,
        max_tokens: 1024,
      });

      return completion.choices[0]?.message?.content?.trim() || content.slice(0, 2000);
    } catch (error) {
      console.error("[Searcher] Summarization error:", error.message);
      return content.slice(0, 2000);
    }
  }

  /**
   * Full search pipeline: search Bing → scrape pages (with limit of 3) → summarize with Groq
   */
  async searchAndSummarize(query) {
    console.log(`\n========== [Searcher] Starting search for: "${query}" ==========`);

    const results = await this.searchWeb(query);
    if (results.length === 0) {
      console.log("[Searcher] ❌ No search results found");
      return { sources: [], summary: "" };
    }

    console.log(`[Searcher] ✓ Got ${results.length} results, scraping up to ${MAX_LINKS_TO_CLICK} pages...`);

    const pagesToScrape = results.slice(0, MAX_LINKS_TO_CLICK);
    const sources = [];
    let allContent = "";

    for (let i = 0; i < pagesToScrape.length; i++) {
      const result = pagesToScrape[i];
      console.log(`[Searcher] 📄 Scraping (${i + 1}/${pagesToScrape.length}): ${result.title}`);

      const pageContent = await this.scrapePage(result.url);

      if (pageContent) {
        sources.push({
          title: result.title,
          url: result.url,
          content: pageContent.slice(0, 500),
        });
        allContent += `\n\n--- Source ${i + 1}: ${result.title} (${result.url}) ---\n${pageContent}`;
      } else {
        sources.push({
          title: result.title,
          url: result.url,
          content: result.snippet || "Could not access page content",
        });
      }
    }

    // Summarize all scraped content with Groq
    console.log(`[Searcher] 🤖 Summarizing ${sources.length} sources with Groq...`);
    const summary = await this.summarizeContent(allContent, query);

    console.log(`[Searcher] ✅ Done - ${sources.length} sources, summary length: ${summary.length} chars`);
    console.log(`========================================\n`);
    return { sources, summary };
  }

  async close() {
    // No cleanup needed for axios-based approach
    console.log("[Searcher] Cleanup done");
  }
}

const searcherInstance = new SearcherService();

process.on("SIGINT", async () => {
  await searcherInstance.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await searcherInstance.close();
  process.exit(0);
});

module.exports = searcherInstance;
