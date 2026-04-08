import { NextRequest, NextResponse } from "next/server";

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

interface PulseResponse {
  success: boolean;
  data: PulseItem[];
  pagination: { page: number; pageSize: number; total: number };
  message?: string;
}

// In-memory cache
let cache: { data: unknown; key: string; ts: number } = { data: null, key: "", ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

/**
 * GET /api/pulse
 * Public proxy for Atypica Pulse API. No auth required for consumers.
 *
 * Query params (all optional):
 *   limit    - 1–50 (default 20)
 *   page     - ≥1 (default 1)
 *   category - filter by category
 *   orderBy  - heatScore | heatDelta | createdAt (default heatDelta)
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.ATYPICA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const { searchParams } = req.nextUrl;
  const limit = searchParams.get("limit") ?? "20";
  const page = searchParams.get("page") ?? "1";
  const category = searchParams.get("category");
  const orderBy = searchParams.get("orderBy") ?? "heatDelta";

  const cacheKey = `${limit}:${page}:${category ?? ""}:${orderBy}`;

  // Return cached data if fresh
  if (cache.data && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data, {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
        "X-Cache": "HIT",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  try {
    const params = new URLSearchParams({ limit, page, orderBy });
    if (category) params.set("category", category);

    const upstream = await fetch(`https://atypica.ai/api/pulse?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 300 },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Upstream ${upstream.status}`, detail: text.slice(0, 200) },
        { status: upstream.status }
      );
    }

    const json: PulseResponse = await upstream.json();

    if (!json.success) {
      return NextResponse.json({ error: json.message ?? "Upstream failure" }, { status: 502 });
    }

    const result = {
      topics: json.data.map((p, i) => ({
        rank: i + 1,
        id: p.id,
        title: p.title,
        content: p.content,
        category: p.category,
        heatScore: p.heatScore,
        heatDelta: p.heatDelta,
        createdAt: p.createdAt,
        searchUrl: `https://x.com/search?q=${encodeURIComponent(p.title)}&f=live`,
      })),
      pagination: json.pagination,
      updatedAt: new Date().toISOString(),
    };

    cache = { data: result, key: cacheKey, ts: Date.now() };

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
        "X-Cache": "MISS",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Fetch failed", detail: message }, { status: 500 });
  }
}
