/**
 * GET /api/pulse
 * Public proxy for Atypica Pulse API.
 * No auth required for consumers — API key is server-side only.
 *
 * Query params (all optional, passed through to Pulse API):
 *   limit   - 1–50 (default 20)
 *   page    - ≥1 (default 1)
 *   category - filter by category
 *   orderBy  - heatScore | heatDelta | createdAt (default heatDelta)
 *
 * Caching: 5 min in-memory + CDN cache headers.
 */

let cache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  // CORS — allow browser extension and any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ATYPICA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: missing API key' });
  }

  // Build query params
  const { limit = '20', page = '1', category, orderBy = 'heatDelta' } = req.query;
  const cacheKey = `${limit}:${page}:${category || ''}:${orderBy}`;

  // Check in-memory cache
  if (cache.data && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cache.data);
  }

  try {
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('page', page);
    params.set('orderBy', orderBy);
    if (category) params.set('category', category);

    const upstream = await fetch(`https://atypica.ai/api/pulse?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}`, detail: text.slice(0, 200) });
    }

    const json = await upstream.json();

    if (!json.success) {
      return res.status(502).json({ error: json.message || 'Upstream returned failure' });
    }

    // Shape response
    const result = {
      topics: (json.data || []).map((p, i) => ({
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

    // Update cache
    cache = { data: result, key: cacheKey, ts: Date.now() };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch from upstream', detail: err.message });
  }
}
