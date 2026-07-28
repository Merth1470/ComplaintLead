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
const POSTHOG_KEY  = process.env.POSTHOG_PUBLIC_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST;
// ============================================================

const express = require("express");
const path = require("path");
const fs = require("fs");
const { PostHog } = require("posthog-node");

const posthog = POSTHOG_KEY && POSTHOG_HOST
  ? new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      enableExceptionAutocapture: true,
    })
  : null;

if (!posthog && process.env.NODE_ENV !== "production") {
  console.error(
    "POSTHOG_PUBLIC_KEY and POSTHOG_HOST variables required by PostHog are missing or un-configured, " +
    "this causes events to be silently missed. " +
    "This error stops appearing once POSTHOG_PUBLIC_KEY is configured"
  );
}

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  const config = JSON.stringify(
    POSTHOG_KEY && POSTHOG_HOST ? { key: POSTHOG_KEY, host: POSTHOG_HOST } : null
  );
  const injected = html.replace("<head>", `<head>\n  <script>window.__POSTHOG_CONFIG__=${config};</script>`);
  res.setHeader("Content-Type", "text/html");
  res.send(injected);
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

const SOURCE_MAP = {
  "reddit.com": "reddit.com",
  "x.com": "x.com",
};

// ---- Step 1: Ask Gemini to turn the brief into an advanced search query ----
async function buildSearchQuery({ category, audience, details, competitors, painPoints, excludeKeywords, source }) {
  const site = SOURCE_MAP[source] || "reddit.com";

  // Format arrays into strings for Gemini prompt / query construction
  const competitorsList = Array.isArray(competitors) ? competitors.join(", ") : (competitors || "");
  const painPointsList = Array.isArray(painPoints) ? painPoints.join(", ") : (painPoints || "");
  const excludeKeywordsList = Array.isArray(excludeKeywords) ? excludeKeywords.join(", ") : (excludeKeywords || "");

  const prompt = `Act as a world-class Boolean Search Architect specializing in B2B Customer Discovery and Lead Generation.

Your ONLY goal is to build a hyper-specific, long-tail Google Search Query that finds REAL PEOPLE complaining, asking for advice, or sharing pain points about a specific problem on social platforms.

Inputs provided by user:
- Product/Category: ${category}
- Target Audience: ${audience}
- Competitors & Alternatives to Monitor: ${competitorsList}
- Pain Point & Intent Triggers: ${painPointsList}
- Exclude Keywords: ${excludeKeywordsList}
- Extra Context: ${details || ""}
- Platform: ${source} (Must be either 'reddit.com' or 'x.com')

### QUERY CONSTRUCTION INSTRUCTIONS:

1. **Targeting Rule:** Start with site:${source}.
    - If platform is 'reddit.com', append (inurl:comments OR inurl:thread).
    - If platform is 'x.com', do not use inurl, instead focus on post content.

2. **Domain/Context Extraction:**
    Extract hyper-specific niche keywords, competitors, or short phrases from ${category}, ${audience}, ${competitorsList}, and ${painPointsList}.
    Group them inside quotes with OR operators, e.g., ("Jira" OR "ClickUp" OR "Monday.com" OR "Productivity SaaS").

3. **High-Intent Emotional Triggers (STRICT INCLUSION):**
    You MUST include a broad set of high-intent "first-person struggle" phrases to filter out blog posts, spam, and SEO articles. Always include a group like this:
    intext:("my biggest struggle" OR "how do you guys" OR "frustrated with" OR "stuck at" OR "no sales" OR "impossible to" OR "any advice" OR "what worked for you")

4. **Negative Filtering:**
    If exclude keywords are provided (${excludeKeywordsList}), append negative search operators by putting like -hiring -job -course -affiliate -agency.

5. **Combine for Maximum Specificity:**
    Assemble the final query using strict AND logic between the domain keywords and the pain-point triggers. Do NOT shorten or simplify the query. Make it as deep and specific as possible to guarantee 100% real human posts.

### OUTPUT FORMAT REQUIREMENTS:
- Output ONLY the raw finalized search query string.
- No markdown code blocks, no quotes surrounding the entire string, no intro or outro text.`;

  const compText = Array.isArray(competitors) && competitors.length ? competitors.join(" ") : "";
  const painText = Array.isArray(painPoints) && painPoints.length ? painPoints.join(" ") : "";
  const excludeText = Array.isArray(excludeKeywords) && excludeKeywords.length ? excludeKeywords.map(k => `-${k.replace(/^-/, '')}`).join(" ") : "";

  const parts = [category, audience, compText, painText, details].filter(Boolean);
  let query = `site:${site} ${parts.join(" ")}`;
  if (excludeText) {
    query += ` ${excludeText}`;
  }
  return query.replace(/\s+/g, " ").trim();
}

// ---- Step 2: Either use SerpApi or return demo results ----
async function runGoogleSearch(query, filters = {}) {
  if (!SERPAPI_API_KEY) {
    return {
      total: 3,
      items: [
        {
          title: "Can't find the right PM tool for my remote team",
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

      // Apply search filters if provided
      if (filters.tbs) {
        url.searchParams.set("tbs", filters.tbs);
      }
      if (filters.language) {
        url.searchParams.set("hl", filters.language);
      }
      if (filters.location) {
        url.searchParams.set("location", filters.location);
      }
      if (filters.countryCode) {
        url.searchParams.set("gl", filters.countryCode);
      }

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
    const { category, audience, details, competitors, painPoints, excludeKeywords, source, filters } = req.body || {};

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

    const query = await buildSearchQuery({ category, audience, details, competitors, painPoints, excludeKeywords, source });
    const { items, total } = await runGoogleSearch(query, filters || {});
    const distinctId = req.get("x-posthog-distinct-id");

    if (posthog && distinctId) {
      posthog.capture({
        distinctId,
        event: "search_processed",
        properties: {
          source,
          result_count: items.length,
          has_results: items.length > 0,
          used_demo_results: !SERPAPI_API_KEY,
        },
      });
      await posthog.flush();
    }

    res.json({ query, source, total, items });
  } catch (err) {
    console.error("[/api/search] error:", err.message);
    const distinctId = req.get("x-posthog-distinct-id");
    if (posthog && distinctId) {
      posthog.captureException(err, distinctId, {
        endpoint: "/api/search",
        method: "POST",
      });
      await posthog.flush();
    }
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n  Complaint Lead Finder running at http://localhost:${PORT}\n`);
});

async function shutdown() {
  if (posthog) await posthog.shutdown();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
