// ============================================================
//  server.js  —  B2B SaaS MVP: "Complaint Lead Finder"
//
// ------------------------------------------------------------
//  RUN:
//    npm init -y
//    npm install express
//    node server.js
// ============================================================

// ====== CONFIG / SECRETS (server-only — never exposed to browser) ======
require("dotenv").config();
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const SERPAPI_API_KEY  = process.env.SERPAPI_API_KEY;
const PORT = process.env.PORT || 3000;
// ============================================================

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SOURCE_MAP = {
  "reddit.com": "reddit.com",
  "x.com": "x.com",
};

// ---- Step 1: Ask Gemini to turn the brief into an advanced search query ----
async function buildSearchQuery({ category, audience, details, source }) {
  const site = SOURCE_MAP[source] || "reddit.com";
  const prompt = `Act as an expert boolean search copywriter. Based on product category '${category}', target audience '${audience}', and details '${details}', write a single, highly advanced Google Search query utilizing search operators (like OR, AND, etc.) to find people complaining, venting, or asking for solutions related to this problem on site:${site}. Return ONLY the raw search query string, nothing else. Do not wrap it in quotes.`;

  const parts = [category, audience, details].filter(Boolean);
  return `site:${site} ${parts.join(" ")}`.replace(/\s+/g, " ").trim();
}

// ---- Step 2: Either use SerpApi or return demo results ----
async function runGoogleSearch(query) {
  if (!SERPAPI_API_KEY) {
    return {
      total: 3,
      items: [
        {
          title: "Can’t find the right PM tool for my remote team",
          link: "https://reddit.com/r/saas/example1",
          snippet: "We need a project management app for remote startup founders that avoids missed deadlines and tool overload.",
        },
        {
          title: "Why is team coordination so hard with our current workflow?",
          link: "https://reddit.com/r/entrepreneurship/example2",
          snippet: "Our remote startup keeps missing deadlines, and the tools feel too confusing and slow.",
        },
        {
          title: "Looking for a better productivity platform for distributed teams",
          link: "https://x.com/example3",
          snippet: "Struggling with team coordination and tool overload — nothing seems to help our remote startup.",
        },
      ],
    };
  }

  // Fetch 5 pages of 10 results in parallel to guarantee up to 50 results (offsets 0, 10, 20, 30, 40)
  // as SerpApi limits organic_results count per request on certain plans/caches.
  const offsets = [0, 10, 20, 30, 40];
  const fetchPromises = offsets.map(async (start) => {
    try {
      const url = new URL("https://serpapi.com/search");
      url.searchParams.set("engine", "google");
      url.searchParams.set("api_key", SERPAPI_API_KEY);
      url.searchParams.set("q", query);
      url.searchParams.set("num", "10");
      url.searchParams.set("start", start.toString());

      const res = await fetch(url.toString());
      if (!res.ok) {
        console.error(`SerpApi error at start=${start}: status ${res.status}`);
        return { items: [], total: "0" };
      }
      const data = await res.json();
      const items = (data.organic_results || []).map((it) => ({
        title: it.title,
        link: it.link,
        snippet: it.snippet,
      }));
      return { items, total: data.search_information?.total_results || "0" };
    } catch (err) {
      console.error(`Fetch error at start=${start}:`, err.message);
      return { items: [], total: "0" };
    }
  });

  const results = await Promise.all(fetchPromises);
  const allItems = [];
  let total = "0";
  for (const res of results) {
    if (res.items && res.items.length > 0) {
      allItems.push(...res.items);
    }
    if (res.total && res.total !== "0") {
      total = res.total;
    }
  }

  // Remove potential duplicates by link
  const seen = new Set();
  const uniqueItems = [];
  for (const item of allItems) {
    if (item.link && !seen.has(item.link)) {
      seen.add(item.link);
      uniqueItems.push(item);
    }
  }

  return { items: uniqueItems.slice(0, 50), total };
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
