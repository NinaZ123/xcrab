import { NextRequest, NextResponse } from "next/server";
import { translateTitles } from "./translate";

// Use Edge runtime — 30s timeout on Hobby (vs 10s for Node.js)
export const runtime = "edge";

interface PulseItem {
  id: number;
  title: string;
  content: string;
  category: string;
  locale: string;
  heatScore: number;
  heatDelta: number | null;
  createdAt: string;
}

interface OpinionViewpoint {
  stance: string;
  summary: string;
}

interface OpinionSummary {
  summary: string;
  overallSentiment?: "positive" | "negative" | "neutral" | "mixed";
  keyViewpoints?: OpinionViewpoint[];
  controversies?: string[];
  generatedAt?: string;
}

interface PulseDetailResponse {
  success: boolean;
  data: {
    posts?: Array<Record<string, unknown>>;
    opinionSummary?: OpinionSummary | null;
  };
  message?: string;
}

interface PulseResponse {
  success: boolean;
  data: PulseItem[];
  pagination: { page: number; pageSize: number; total: number };
  message?: string;
}

// In-memory cache per lang (survives warm invocations)
const cache: Record<string, { data: unknown; key: string; ts: number }> = {};
const CACHE_TTL = 5 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
};

function getUpstreamBaseUrl(): string {
  return (process.env.ATYPICA_API_BASE_URL || "https://atypica.ai").replace(/\/$/, "");
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function extractTwitterSourceUrls(posts: Array<Record<string, unknown>>): string[] {
  const urlRegex = /https?:\/\/(?:x|twitter)\.com\/[^\s"')\]}]+/gi;
  const discovered = new Set<string>();

  for (const post of posts) {
    const payload = JSON.stringify(post);
    const matches = payload.match(urlRegex);
    if (!matches) continue;
    for (const rawUrl of matches) {
      discovered.add(normalizeUrl(rawUrl));
    }
  }

  return [...discovered].sort((left, right) => left.length - right.length);
}

async function enrichPulseTopic(
  pulse: {
    id: number;
    title: string;
    content: string;
    category: string;
    heatScore: number;
    heatDelta: number | null;
    createdAt: string;
    rank: number;
  },
  apiKey: string,
  upstreamBaseUrl: string,
): Promise<{
  id: number;
  title: string;
  content: string;
  category: string;
  heatScore: number;
  heatDelta: number | null;
  createdAt: string;
  rank: number;
  searchUrl: string;
  sourceUrl: string | null;
  sourceUrls: string[];
  opinionSummary: OpinionSummary | null;
}> {
  try {
    const detail = await fetch(`${upstreamBaseUrl}/api/pulse/${pulse.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!detail.ok) {
      return {
        ...pulse,
        searchUrl: `https://x.com/search?q=${encodeURIComponent(pulse.title)}&f=live`,
        sourceUrl: null,
        sourceUrls: [],
        opinionSummary: null,
      };
    }

    const json: PulseDetailResponse = await detail.json();
    const posts = json.success ? json.data.posts ?? [] : [];
    const sourceUrls = extractTwitterSourceUrls(posts);
    const sourceUrl = sourceUrls[0] ?? null;

    return {
      ...pulse,
      searchUrl: `https://x.com/search?q=${encodeURIComponent(pulse.title)}&f=live`,
      sourceUrl,
      sourceUrls,
      opinionSummary: json.success ? json.data.opinionSummary ?? null : null,
    };
  } catch {
    return {
      ...pulse,
      searchUrl: `https://x.com/search?q=${encodeURIComponent(pulse.title)}&f=live`,
      sourceUrl: null,
      sourceUrls: [],
      opinionSummary: null,
    };
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.ATYPICA_API_KEY;
  const upstreamBaseUrl = getUpstreamBaseUrl();
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500, headers: CORS });
  }

  const sp = req.nextUrl.searchParams;
  const limit = sp.get("limit") ?? "20";
  const page = sp.get("page") ?? "1";
  const category = sp.get("category");
  const orderBy = sp.get("orderBy") ?? "heatDelta";
  const lang = sp.get("lang") ?? "en";

  const cacheKey = `${limit}:${page}:${category ?? ""}:${orderBy}:${lang}`;
  const c = cache[lang];
  if (c && c.key === cacheKey && Date.now() - c.ts < CACHE_TTL) {
    return NextResponse.json(c.data, {
      headers: { ...CORS, "Cache-Control": "s-maxage=300, stale-while-revalidate=60", "X-Cache": "HIT" },
    });
  }

  try {
    // Always fetch more from upstream, we'll filter and sort ourselves
    const fetchLimit = Math.max(parseInt(limit) * 2, 50);
    const params = new URLSearchParams({ limit: String(fetchLimit), page, orderBy: "createdAt" });
    if (category) params.set("category", category);

    const upstream = await fetch(`${upstreamBaseUrl}/api/pulse?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json({ error: `Upstream ${upstream.status}`, detail: text.slice(0, 200) }, { status: upstream.status, headers: CORS });
    }

    const json: PulseResponse = await upstream.json();
    if (!json.success) {
      return NextResponse.json({ error: json.message ?? "Upstream failure" }, { status: 502, headers: CORS });
    }

    let topics = json.data
      .filter((p) => p.heatScore != null && p.heatScore > 0)
      .map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        category: p.category,
        heatScore: p.heatScore,
        heatDelta: p.heatDelta,
        createdAt: p.createdAt,
      }));

    // Sort: heatScore desc or createdAt desc
    if (orderBy === "heatScore") {
      topics.sort((a, b) => (b.heatScore ?? 0) - (a.heatScore ?? 0));
    } else {
      topics.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // Apply limit and rank
    topics = topics.slice(0, parseInt(limit)).map((t, i) => ({ ...t, rank: i + 1 }));

    topics = await Promise.all(topics.map((topic) => enrichPulseTopic(topic, apiKey, upstreamBaseUrl)));

    // Translate titles if zh
    let translated = false;
    if (lang === "zh" && topics.length > 0) {
      const ppioKey = process.env.PPIO_API_KEY;
      if (ppioKey) {
        const zhTitles = await translateTitles(
          topics.map((t) => t.title),
          ppioKey
        );
        // Check if translation actually happened (not just returned originals)
        const didTranslate = zhTitles.some((zh, i) => zh !== topics[i].title);
        if (didTranslate) {
          translated = true;
          topics = topics.map((t, i) => ({
            ...t,
            titleEn: t.title,
            title: zhTitles[i],
          }));
        }
      }
    }

    const result = { topics, pagination: json.pagination, updatedAt: new Date().toISOString(), lang };

    // Only cache if translation succeeded (or lang=en). Don't cache failed translations.
    const shouldCache = lang !== "zh" || translated;
    if (shouldCache) {
      cache[lang] = { data: result, key: cacheKey, ts: Date.now() };
    }

    // CDN cache: only cache en or successfully translated zh
    const cacheControl = shouldCache ? "s-maxage=300, stale-while-revalidate=60" : "no-store";

    return NextResponse.json(result, {
      headers: { ...CORS, "Cache-Control": cacheControl, "X-Cache": "MISS", "X-Translated": String(translated) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Fetch failed", detail: message }, { status: 500, headers: CORS });
  }
}
