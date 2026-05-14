import { NextRequest, NextResponse } from "next/server";
import { translateTitles, translateToEnglish } from "./translate";
import { splitMixedTitle } from "./fallback-translate";

// Use Edge runtime — 30s timeout on Hobby (vs 10s for Node.js)
export const runtime = "edge";

interface PulseItem {
  id: number;
  title: string;
  titleEn?: string;
  titleZh?: string;
  originalTitle?: string;
  detectedLang?: 'en' | 'zh' | 'mixed';
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

// Enhanced cache structure
interface CacheData {
  topics: Array<{
    id: number;
    title: string;
    titleEn: string;
    titleZh: string;
    originalTitle: string;
    detectedLang: 'en' | 'zh' | 'mixed';
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
  }>;
  fetchedAt: number;
  fetchedLimit: number;
  orderBy: string;
}

const cache: { data: CacheData | null } = { data: null };
const CACHE_TTL = 60 * 1000; // 1 minute

// Language detection
function detectLanguage(title: string): 'en' | 'zh' | 'mixed' {
  const hasChinese = /[一-龥]/.test(title);
  const hasEnglish = /[a-zA-Z]/.test(title);

  if (hasChinese && hasEnglish) return 'mixed';
  if (hasChinese) return 'zh';
  return 'en';
}

// Check if cache can be used
function shouldUseCacheData(requestedLimit: number, cache: CacheData | null): { use: boolean; data?: unknown } {
  if (!cache || !cache.topics || cache.topics.length === 0) {
    return { use: false };
  }

  if (Date.now() - cache.fetchedAt > CACHE_TTL) {
    return { use: false };
  }

  if (requestedLimit > cache.topics.length) {
    return { use: false };
  }

  return { use: true, data: cache.topics.slice(0, requestedLimit) };
}

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

function numericField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function scorePost(record: Record<string, unknown>): number {
  const directScore =
    numericField(record, "heatScore") ||
    numericField(record, "hotScore") ||
    numericField(record, "score") ||
    numericField(record, "engagementScore");

  if (directScore > 0) return directScore;

  return (
    numericField(record, "likeCount") +
    numericField(record, "likes") +
    numericField(record, "retweetCount") * 2 +
    numericField(record, "repostCount") * 2 +
    numericField(record, "replyCount") * 2 +
    numericField(record, "quoteCount") * 2 +
    numericField(record, "bookmarkCount") +
    numericField(record, "viewCount") * 0.01 +
    numericField(record, "impressionCount") * 0.01
  );
}

function extractTwitterSourceUrls(posts: Array<Record<string, unknown>>): string[] {
  const urlRegex = /https?:\/\/(?:x|twitter)\.com\/[^\s"')\]}]+/gi;
  const discovered = new Set<string>();
  const sourceCandidates: Array<{ url: string; score: number; index: number }> = [];

  posts.forEach((post, index) => {
    const payload = JSON.stringify(post);
    const matches = payload.match(urlRegex);
    if (!matches) return;
    for (const rawUrl of matches) {
      const url = normalizeUrl(rawUrl);
      if (discovered.has(url)) continue;
      discovered.add(url);
      sourceCandidates.push({ url, score: scorePost(post), index });
    }
  });

  return sourceCandidates
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.url);
}

async function enrichPulseTopic(
  pulse: {
    id: number;
    title: string;
    titleEn?: string;
    titleZh?: string;
    originalTitle?: string;
    detectedLang?: 'en' | 'zh' | 'mixed';
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
  titleEn?: string;
  titleZh?: string;
  originalTitle?: string;
  detectedLang?: 'en' | 'zh' | 'mixed';
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
  const limit = parseInt(sp.get("limit") ?? "20");
  const page = sp.get("page") ?? "1";
  const category = sp.get("category");
  const orderBy = sp.get("orderBy") ?? "heatDelta";
  const lang = sp.get("lang") ?? "en";
  const forceRefresh = sp.get("forceRefresh") === "true";

  // Check if we can use cached data (skip if forceRefresh)
  const cacheCheck = forceRefresh ? { use: false } : shouldUseCacheData(limit, cache.data);
  if (cacheCheck.use && cache.data) {
    console.log(`\n✅ CACHE HIT: Returning ${limit} topics from cache (${cache.data.topics.length} available)`);

    const cachedTopics = cacheCheck.data as typeof cache.data.topics;
    const result = {
      topics: cachedTopics,
      pagination: { page: parseInt(page), pageSize: limit, total: cachedTopics.length },
      updatedAt: new Date(cache.data.fetchedAt).toISOString(),
      lang,
    };

    return NextResponse.json(result, {
      headers: { ...CORS, "Cache-Control": "s-maxage=300, stale-while-revalidate=60", "X-Cache": "HIT" },
    });
  }

  console.log(`\n🔄 CACHE MISS: Fetching new data (requested: ${limit})`);

  try {
    // Always fetch more from upstream, we'll filter and sort ourselves
    const fetchLimit = Math.max(limit * 2, 50);
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

    // Print RAW titles and dates from Atypica backend (no processing at all)
    console.log("\n" + "=".repeat(80));
    console.log("🔍 RAW DATA FROM ATYPICA BACKEND (Original Response)");
    console.log("=".repeat(80));
    json.data?.forEach((item, i) => {
      console.log(`${i + 1}. [${item.createdAt}] ${item.title}`);
    });
    console.log("=".repeat(80) + "\n");

    if (!json.success) {
      return NextResponse.json({ error: json.message ?? "Upstream failure" }, { status: 502, headers: CORS });
    }

    let topics = json.data
      .filter((p) => p.heatScore != null && p.heatScore > 0)
      .map((p) => {
        const detectedLang = detectLanguage(p.title);
        return {
          id: p.id,
          title: p.title,
          titleEn: p.titleEn,
          titleZh: undefined,
          originalTitle: p.title,
          detectedLang,
          content: p.content,
          category: p.category,
          heatScore: p.heatScore,
          heatDelta: p.heatDelta,
          createdAt: p.createdAt,
        };
      });

    // Sort: heatScore desc or createdAt desc
    if (orderBy === "heatScore") {
      topics.sort((a, b) => (b.heatScore ?? 0) - (a.heatScore ?? 0));
    } else {
      topics.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    console.log(`\n📊 AFTER SORTING (orderBy: ${orderBy}, showing first 5):`);
    topics.slice(0, 5).forEach((t, i) => {
      console.log(`${i + 1}. [${t.createdAt}] ${t.title.slice(0, 50)}...`);
    });

    // Apply limit and rank
    let enrichedTopics = await Promise.all(
      topics
        .slice(0, limit)
        .map((t, i) => enrichPulseTopic({ ...t, rank: i + 1 }, apiKey, upstreamBaseUrl))
    );

    // Smart bilingual translation
    const ppioKey = process.env.PPIO_API_KEY;
    const needEnToZh: typeof enrichedTopics = [];
    const needZhToEn: typeof enrichedTopics = [];

    console.log("\n" + "─".repeat(80));
    console.log("🔍 LANGUAGE DETECTION RESULTS");
    console.log("─".repeat(80));

    // Categorize topics by what translation they need
    enrichedTopics.forEach((topic) => {
      const hasChinese = /[一-龥]/.test(topic.originalTitle || '');
      const hasEnglish = /[a-zA-Z]/.test(topic.originalTitle || '');

      if (hasChinese) {
        // Has Chinese (pure or mixed) → need English translation
        topic.titleZh = topic.originalTitle;
        if (!topic.titleEn && ppioKey) {
          needZhToEn.push(topic);
        }
      }

      if (hasEnglish || !hasChinese) {
        // Has English or is unknown → need Chinese translation
        topic.titleEn = topic.titleEn || topic.originalTitle;
        if (!topic.titleZh && ppioKey) {
          needEnToZh.push(topic);
        }
      }
    });

    const pureEn = enrichedTopics.filter(t => t.detectedLang === 'en').length;
    const pureZh = enrichedTopics.filter(t => t.detectedLang === 'zh').length;
    const mixed = enrichedTopics.filter(t => t.detectedLang === 'mixed').length;

    console.log(`Pure EN: ${pureEn} | Pure ZH: ${pureZh} | Mixed: ${mixed} | Total: ${enrichedTopics.length}`);
    console.log(`Need EN→ZH translation: ${needEnToZh.length}`);
    console.log(`Need ZH→EN translation: ${needZhToEn.length}`);
    console.log(`PPIO API Key available: ${ppioKey ? 'YES' : 'NO'}`);
    console.log("─".repeat(80));

    // Batch translate English to Chinese
    if (needEnToZh.length > 0 && ppioKey) {
      console.log(`\n🔄 Translating ${needEnToZh.length} titles: EN → ZH`);
      try {
        const zhTitles = await translateTitles(
          needEnToZh.map((t) => t.titleEn!),
          ppioKey
        );
        needEnToZh.forEach((topic, i) => {
          topic.titleZh = zhTitles[i];
        });
        console.log(`✅ Translation complete: EN → ZH`);
      } catch (err) {
        console.error(`❌ Translation failed: EN → ZH`, err);
        // Smart fallback: try to split mixed titles
        needEnToZh.forEach((topic) => {
          const split = splitMixedTitle(topic.titleEn!);
          topic.titleZh = split.zh;
          console.log(`[Fallback] ${topic.titleEn} → ZH: ${split.zh}`);
        });
      }
    }

    // Batch translate Chinese to English
    if (needZhToEn.length > 0 && ppioKey) {
      console.log(`\n🔄 Translating ${needZhToEn.length} titles: ZH → EN`);
      console.log("Chinese titles to translate:");
      needZhToEn.slice(0, 3).forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.titleZh}`);
      });
      if (needZhToEn.length > 3) console.log(`  ... and ${needZhToEn.length - 3} more`);

      try {
        const enTitles = await translateToEnglish(
          needZhToEn.map((t) => t.titleZh!),
          ppioKey
        );
        needZhToEn.forEach((topic, i) => {
          topic.titleEn = enTitles[i];
        });
        console.log(`✅ Translation complete: ZH → EN`);
        console.log("Sample results:");
        needZhToEn.slice(0, 3).forEach((t, i) => {
          console.log(`  ${i + 1}. ${t.titleZh} → ${t.titleEn}`);
        });
      } catch (err) {
        console.error(`❌ Translation failed: ZH → EN`, err);
        // Smart fallback: try to split mixed titles
        needZhToEn.forEach((topic) => {
          const split = splitMixedTitle(topic.titleZh!);
          topic.titleEn = split.en;
          console.log(`[Fallback] ${topic.titleZh} → EN: ${split.en}`);
        });
      }
    }

    // Ensure all topics have both languages
    enrichedTopics.forEach((topic) => {
      topic.titleEn = topic.titleEn || topic.originalTitle || topic.title;
      topic.titleZh = topic.titleZh || topic.originalTitle || topic.title;
      // Set display title based on requested language
      topic.title = lang === 'zh' ? topic.titleZh : topic.titleEn;
    });

    // Translate categories (collect unique categories and translate once)
    const uniqueCategories = [...new Set(enrichedTopics.map(t => t.category).filter(Boolean))];
    const categoryTranslations: Record<string, { en: string; zh: string }> = {};

    console.log(`\n🏷️  Translating ${uniqueCategories.length} unique categories...`);

    if (uniqueCategories.length > 0 && ppioKey) {
      // Separate English and Chinese categories
      const enCategories: string[] = [];
      const zhCategories: string[] = [];

      uniqueCategories.forEach(cat => {
        const hasChinese = /[一-龥]/.test(cat);
        if (hasChinese) {
          zhCategories.push(cat);
        } else {
          enCategories.push(cat);
        }
      });

      console.log(`  EN categories: ${enCategories.length}`, enCategories);
      console.log(`  ZH categories: ${zhCategories.length}`, zhCategories);

      try {
        // Translate English categories to Chinese
        if (enCategories.length > 0) {
          const zhTranslations = await translateTitles(enCategories, ppioKey);
          enCategories.forEach((cat, i) => {
            categoryTranslations[cat] = {
              en: cat,
              zh: zhTranslations[i] || cat
            };
          });
        }

        // Translate Chinese categories to English
        if (zhCategories.length > 0) {
          const enTranslations = await translateToEnglish(zhCategories, ppioKey);
          zhCategories.forEach((cat, i) => {
            categoryTranslations[cat] = {
              en: enTranslations[i] || cat,
              zh: cat
            };
          });
        }

        console.log('✅ Category translations:', categoryTranslations);
      } catch (err) {
        console.error('❌ Category translation failed:', err);
        // Smart fallback: try to split mixed categories
        uniqueCategories.forEach(cat => {
          const split = splitMixedTitle(cat);
          categoryTranslations[cat] = {
            en: split.en,
            zh: split.zh
          };
        });
      }
    } else {
      // No translation needed or API unavailable
      console.log('⚠️  No PPIO API key, using smart fallback...');
      uniqueCategories.forEach(cat => {
        const split = splitMixedTitle(cat);
        categoryTranslations[cat] = {
          en: split.en,
          zh: split.zh
        };
      });
    }

    // Apply category translations to topics
    enrichedTopics.forEach((topic) => {
      const trans = categoryTranslations[topic.category];
      if (trans) {
        (topic as any).categoryEn = trans.en;
        (topic as any).categoryZh = trans.zh;
      }
    });

    // Remove duplicates based on titleEn (keep higher heatScore)
    const originalCount = enrichedTopics.length;
    const seenTitles = new Map<string, typeof enrichedTopics[0]>();
    enrichedTopics.forEach((topic) => {
      const key = (topic.titleEn ?? '').toLowerCase().trim();
      const existing = seenTitles.get(key);
      if (!existing || topic.heatScore > existing.heatScore) {
        seenTitles.set(key, topic);
      }
    });
    enrichedTopics = Array.from(seenTitles.values());

    console.log(`\n🔍 DEDUPLICATION: ${originalCount} → ${enrichedTopics.length} (removed ${originalCount - enrichedTopics.length} duplicates)`);

    // Update cache with full bilingual data
    cache.data = {
      topics: enrichedTopics as CacheData['topics'],
      fetchedAt: Date.now(),
      fetchedLimit: enrichedTopics.length,
      orderBy,
    };

    console.log(`\n💾 CACHE UPDATED: Stored ${enrichedTopics.length} topics with full bilingual data`);

    // Debug: Print all bilingual titles
    console.log("\n" + "=".repeat(80));
    console.log("🔍 DEBUG: STORED BILINGUAL DATA");
    console.log("=".repeat(80));
    enrichedTopics.forEach((topic, i) => {
      const enFlag = /[一-龥]/.test(topic.titleEn || '') ? '❌ HAS CHINESE' : '✅';
      const zhFlag = /[a-zA-Z]/.test(topic.titleZh || '') && /[一-龥]/.test(topic.titleZh || '') ? '⚠️ MIXED' : '✅';

      console.log(`\n${i + 1}. [${topic.detectedLang}]`);
      console.log(`   Original: ${topic.originalTitle}`);
      console.log(`   titleEn:  ${topic.titleEn} ${enFlag}`);
      console.log(`   titleZh:  ${topic.titleZh} ${zhFlag}`);
    });
    console.log("=".repeat(80) + "\n");

    const result = {
      topics: enrichedTopics.slice(0, limit),
      pagination: json.pagination,
      updatedAt: new Date().toISOString(),
      lang,
    };

    console.log(`\n📤 RETURNING: ${result.topics.length} topics (lang: ${lang})`);
    console.log(`   Cache has: ${cache.data.topics.length} topics for future requests\n`);

    return NextResponse.json(result, {
      headers: { ...CORS, "Cache-Control": "s-maxage=300, stale-while-revalidate=60", "X-Cache": "MISS" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Fetch failed", detail: message }, { status: 500, headers: CORS });
  }
}
