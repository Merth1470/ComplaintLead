// ============================================================
//  server.js  —  B2B SaaS MVP: "Complaint Lead Finder"
//  Two-step pipeline:  Gemini (build query)  ->  Google Custom Search (results)
// ------------------------------------------------------------
//  RUN:
//    npm init -y
//    npm install express @google/generativeai
//    node server.js
// ============================================================

// ====== CONFIG / SECRETS (server-only — never exposed to browser) ======
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY   || AIzaSyDFfgZH3Qvh7Qc3f0r1ZiAj1JdoZNGwfbY;      // Google AI Studio
const GOOGLE_API_KEY   = process.env.GOOGLE_API_KEY   || "YOUR_GOOGLE_SEARCH_API_KEY"; // CSE API key
const GOOGLE_CX_ENG_ID = process.env.GOOGLE_CX_ENG_ID || c6561443623694db3;  // Custom Search Engine ID
const PORT = process.env.PORT || 3000;
// ============================================================

const express = require("express");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generativeai");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const SOURCE_MAP = {
  "reddit.com": "reddit.com",
  "x.com": "x.com",
};

// ---- Step 1: Ask Gemini to turn the brief into an advanced search query ----
async function buildSearchQuery({ category, audience, details, source }) {
  const site = SOURCE_MAP[source] || "reddit.com";
  const prompt = `Act as an expert boolean search copywriter. Based on product category '${category}', target audience '${audience}', and details '${details}', write a single, highly advanced Google Search query utilizing search operators (like OR, AND, etc.) to find people complaining, venting, or asking for solutions related to this problem on site:${site}. Return ONLY the raw search query string, nothing else. Do not wrap it in quotes.`;

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  let query = response.text().trim();

  // Defensive: strip accidental wrapping quotes / markdown fences
  query = query.replace(/^```[a-zA-Z]*\n?/i, "").replace(/```$/i, "").trim();
  query = query.replace(/^["']|["']$/g, "").trim();

  return query;
}

// ---- Step 2: Run the query through Google Custom Search JSON API ----
async function runGoogleSearch(query) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CX_ENG_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Google Search API error ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  const items = (data.items || []).map((it) => ({
    title: it.title,
    link: it.link,
    snippet: it.snippet,
  }));
  return { items, total: data.searchInformation?.totalResults || "0" };
}

// ---- Single POST endpoint ----
app.post("/api/search", async (req, res) => {
  try {
    const { category, audience, details, source } = req.body || {};

    if (!category || !audience || !source) {
      return res
        .status(400)
        .json({ error: "category, audience and source are required." });
    }
    if (!SOURCE_MAP[source]) {
      return res
        .status(400)
        .json({ error: "source must be 'reddit.com' or 'x.com'." });
    }

    const query = await buildSearchQuery({ category, audience, details, source });
    const { items, total } = await runGoogleSearch(query);

    res.json({ query, source, total, items });
  } catch (err) {
    console.error("[/api/search] error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Complaint Lead Finder running at http://localhost:${PORT}\n`);
});
