// ==UserScript==
// @name         X Trending Tracker
// @namespace    https://github.com/tezign/x-trending-tracker
// @version      1.0.0
// @description  Floating tracker for X trends with hot-topic detection and ranking panel.
// @author       Tezign
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEYS = {
    SNAPSHOT: 'xTrendTracker:snapshot',
    SEEN_TOPICS: 'xTrendTracker:seenTopics',
    TOP3: 'xTrendTracker:top3',
    LAST_URL: 'xTrendTracker:lastUrl'
  };

  const REFRESH_MS = 5 * 60 * 1000;
  const MAX_TOPICS = 10;

  const CATEGORY_COLORS = {
    AI: '#39a0ff',
    Politics: '#f56c6c',
    Finance: '#f8b84e',
    Entertainment: '#d17aff',
    Sports: '#57d28c',
    Other: '#8b98a5'
  };

  const CATEGORY_KEYWORDS = {
    AI: ['ai', 'artificial intelligence', 'openai', 'chatgpt', 'llm', 'gpt', 'machine learning', 'deep learning', 'anthropic', 'gemini', 'claude'],
    Politics: ['election', 'president', 'senate', 'congress', 'government', 'minister', 'vote', 'democrat', 'republican', 'policy', 'geopolitics', 'white house', 'parliament'],
    Finance: ['stock', 'nasdaq', 'dow', 's&p', 'crypto', 'bitcoin', 'ethereum', 'market', 'finance', 'fed', 'inflation', 'interest rate', 'earnings', 'ipo'],
    Entertainment: ['movie', 'film', 'music', 'celebrity', 'netflix', 'disney', 'series', 'album', 'show', 'hollywood', 'actor', 'singer', 'tv'],
    Sports: ['nba', 'nfl', 'mlb', 'nhl', 'fifa', 'soccer', 'football', 'tennis', 'olympics', 'ufc', 'cricket', 'golf', 'formula 1', 'f1']
  };

  const state = {
    topics: [],
    fireActive: false,
    panelOpen: false,
    lastUpdatedAt: 0,
    refreshTimer: null,
    urlWatchTimer: null,
    lastUrl: location.href,
    domObserver: null
  };

  function safeParse(json, fallback) {
    try {
      return JSON.parse(json);
    } catch (_) {
      return fallback;
    }
  }

  function loadSeenTopics() {
    const arr = safeParse(localStorage.getItem(STORAGE_KEYS.SEEN_TOPICS), []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function saveSeenTopics(set) {
    localStorage.setItem(STORAGE_KEYS.SEEN_TOPICS, JSON.stringify(Array.from(set)));
  }

  function loadPreviousTop3() {
    const arr = safeParse(localStorage.getItem(STORAGE_KEYS.TOP3), []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveTop3(top3) {
    localStorage.setItem(STORAGE_KEYS.TOP3, JSON.stringify(top3));
  }

  function loadPreviousSnapshot() {
    return safeParse(localStorage.getItem(STORAGE_KEYS.SNAPSHOT), null);
  }

  function saveSnapshot(payload) {
    localStorage.setItem(STORAGE_KEYS.SNAPSHOT, JSON.stringify(payload));
  }

  function normalizeTopicName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function decodeSearchTopic(href) {
    try {
      const url = new URL(href, location.origin);
      const q = url.searchParams.get('q');
      if (!q) return '';
      const decoded = decodeURIComponent(q).replace(/^#/, '#');
      return normalizeTopicName(decoded);
    } catch (_) {
      return '';
    }
  }

  function parseCompactNumber(input) {
    if (!input) return 0;
    const normalized = String(input).replace(/,/g, '').trim();
    const m = normalized.match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!m) return 0;
    const base = Number(m[1]) || 0;
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') return Math.round(base * 1e3);
    if (suffix === 'm') return Math.round(base * 1e6);
    if (suffix === 'b') return Math.round(base * 1e9);
    return Math.round(base);
  }

  function formatCount(num) {
    if (!Number.isFinite(num) || num <= 0) return 'N/A';
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return String(num);
  }

  function extractCountFromText(text) {
    if (!text) return 0;
    const match = text.match(/(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([KMBkmb])?\s*(posts?|tweets?)/i);
    if (!match) return 0;
    return parseCompactNumber(`${match[1]}${match[2] || ''}`);
  }

  function getCategory(text) {
    const sample = String(text || '').toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => sample.includes(kw))) {
        return category;
      }
    }
    return 'Other';
  }

  function parseCategoryFromCardText(cardText) {
    const m = cardText.match(/Trending in\s+([^·\n]+)/i);
    if (m && m[1]) {
      const guessed = getCategory(m[1]);
      if (guessed !== 'Other') return guessed;
    }
    return getCategory(cardText);
  }

  function velocityFromCounts(currCount, prevCount, elapsedMs) {
    if (!prevCount || !currCount || elapsedMs <= 0) {
      return { label: 'new', icon: '•', deltaPerHour: 0 };
    }
    const delta = currCount - prevCount;
    const perHour = delta / (elapsedMs / 3600000);

    if (perHour > 20000) return { label: 'surging', icon: '🚀', deltaPerHour: perHour };
    if (perHour > 3000) return { label: 'rising', icon: '↗', deltaPerHour: perHour };
    if (perHour < -3000) return { label: 'falling', icon: '↘', deltaPerHour: perHour };
    return { label: 'steady', icon: '→', deltaPerHour: perHour };
  }

  function getTrendRoots() {
    const roots = [];
    const aside = document.querySelector('aside[role="complementary"]');
    if (aside) roots.push(aside);

    const trendTimeline = document.querySelector('[aria-label*="Trending" i], [aria-label*="What\'s happening" i], [data-testid*="trend" i]');
    if (trendTimeline) roots.push(trendTimeline);

    if (!roots.length) roots.push(document.body);
    return roots;
  }

  function scrapeTrendsFromDOM() {
    const roots = getTrendRoots();
    const dedupe = new Map();

    for (const root of roots) {
      const anchors = root.querySelectorAll('a[href*="/search?q="]');
      for (const a of anchors) {
        const topic = decodeSearchTopic(a.getAttribute('href') || '');
        if (!topic || topic.length > 120) continue;

        const card = a.closest('article, [role="link"], [data-testid*="trend" i], div');
        const cardText = (card ? card.textContent : a.textContent) || '';

        if (!/(posts?|tweets?|trending|what\'s happening|news|politics|sports|entertainment|business|technology)/i.test(cardText)) {
          continue;
        }

        const count = extractCountFromText(cardText);
        const category = parseCategoryFromCardText(cardText);

        if (!dedupe.has(topic)) {
          dedupe.set(topic, {
            name: topic,
            count,
            category,
            rawText: cardText,
            discoveredAt: Date.now()
          });
        } else {
          const prev = dedupe.get(topic);
          if (count > prev.count) prev.count = count;
        }
      }
    }

    return Array.from(dedupe.values()).slice(0, 30);
  }

  function mergeWithFallback(scraped, previousTopics) {
    if (scraped.length) return scraped;
    return Array.isArray(previousTopics) ? previousTopics : [];
  }

  function buildRankedTopics(scrapedTopics, previousSnapshot) {
    const previousMap = new Map();
    const previousTopics = (previousSnapshot && Array.isArray(previousSnapshot.topics)) ? previousSnapshot.topics : [];
    for (const t of previousTopics) {
      previousMap.set(t.name, t);
    }

    const seenTopics = loadSeenTopics();

    const now = Date.now();
    const elapsedMs = previousSnapshot && previousSnapshot.updatedAt ? (now - previousSnapshot.updatedAt) : REFRESH_MS;

    const ranked = scrapedTopics
      .map((topic, idx) => {
        const prev = previousMap.get(topic.name);
        const velocity = velocityFromCounts(topic.count, prev ? prev.count : 0, elapsedMs);

        return {
          rank: idx + 1,
          name: topic.name,
          count: topic.count || 0,
          category: topic.category || 'Other',
          velocity,
          isNew: !seenTopics.has(topic.name),
          searchUrl: `https://x.com/search?q=${encodeURIComponent(topic.name)}&src=trend_click&f=live`
        };
      })
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.rank - b.rank;
      })
      .slice(0, MAX_TOPICS)
      .map((topic, i) => ({ ...topic, rank: i + 1 }));

    for (const topic of ranked) seenTopics.add(topic.name);
    saveSeenTopics(seenTopics);

    return ranked;
  }

  function detectNewTop3(rankedTopics) {
    const previousTop3 = loadPreviousTop3();
    const currentTop3 = rankedTopics.slice(0, 3).map((t) => t.name);

    const entered = currentTop3.filter((name) => !previousTop3.includes(name));

    for (const t of rankedTopics) {
      t.isTop3New = entered.includes(t.name) && t.rank <= 3;
    }

    saveTop3(currentTop3);

    return entered.length > 0;
  }

  function ensureRootUI() {
    if (document.getElementById('xtrt-root')) return;

    const style = document.createElement('style');
    style.id = 'xtrt-style';
    style.textContent = `
      #xtrt-root { position: fixed; inset: 0; pointer-events: none; z-index: 999999; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #xtrt-ball {
        position: fixed;
        right: 22px;
        bottom: 22px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(145deg, #1d9bf0, #175f8f);
        box-shadow: 0 8px 28px rgba(0,0,0,0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 700;
        cursor: pointer;
        pointer-events: auto;
        user-select: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      #xtrt-ball:hover { transform: translateY(-1px) scale(1.03); box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
      #xtrt-ball .xtrt-count { font-size: 14px; line-height: 1; }
      #xtrt-ball .xtrt-fire {
        position: absolute;
        top: -12px;
        right: -8px;
        font-size: 18px;
        opacity: 0;
        transform: scale(0.6);
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      #xtrt-ball.fire { animation: xtrtBallPulse 1.2s infinite ease-in-out; }
      #xtrt-ball.fire .xtrt-fire { opacity: 1; animation: xtrtFlame 0.9s infinite ease-in-out; }
      #xtrt-panel {
        position: fixed;
        top: 0;
        right: -370px;
        width: 350px;
        height: 100vh;
        background: rgba(20, 24, 28, 0.96);
        color: #e7e9ea;
        border-left: 1px solid rgba(56, 68, 77, 0.9);
        box-shadow: -20px 0 35px rgba(0,0,0,0.45);
        pointer-events: auto;
        transition: right 0.3s ease;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(5px);
      }
      #xtrt-panel.open { right: 0; }
      #xtrt-panel-header {
        padding: 14px 14px 10px;
        border-bottom: 1px solid rgba(56, 68, 77, 0.9);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      #xtrt-title { font-size: 16px; font-weight: 700; }
      #xtrt-meta { font-size: 12px; color: #8b98a5; margin-top: 4px; }
      #xtrt-refresh {
        border: 1px solid #2f3336;
        background: #16181c;
        color: #e7e9ea;
        border-radius: 999px;
        font-size: 12px;
        line-height: 1;
        padding: 7px 10px;
        cursor: pointer;
      }
      #xtrt-refresh:hover { background: #1d2024; }
      #xtrt-list {
        margin: 0;
        padding: 8px;
        list-style: none;
        overflow-y: auto;
        flex: 1;
      }
      .xtrt-item {
        display: grid;
        grid-template-columns: 24px 1fr auto;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(56, 68, 77, 0.7);
        border-radius: 12px;
        padding: 10px;
        margin: 8px 0;
        background: rgba(28, 31, 35, 0.9);
        cursor: pointer;
      }
      .xtrt-item:hover { background: rgba(38, 42, 47, 0.95); }
      .xtrt-rank { color: #8b98a5; font-size: 12px; font-weight: 700; text-align: center; }
      .xtrt-name { font-size: 14px; font-weight: 600; word-break: break-word; }
      .xtrt-sub { margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #8b98a5; }
      .xtrt-tag {
        font-size: 10px;
        font-weight: 700;
        border-radius: 999px;
        padding: 2px 7px;
        border: 1px solid currentColor;
      }
      .xtrt-new {
        font-size: 10px;
        color: #ffd56b;
        border: 1px solid #ffd56b;
        border-radius: 999px;
        padding: 2px 6px;
        font-weight: 700;
      }
      .xtrt-velocity { font-size: 11px; color: #8b98a5; font-weight: 600; }
      .xtrt-empty {
        padding: 16px;
        color: #8b98a5;
        font-size: 13px;
      }
      @keyframes xtrtBallPulse {
        0%, 100% { transform: scale(1); box-shadow: 0 8px 28px rgba(0,0,0,0.45); }
        50% { transform: scale(1.08); box-shadow: 0 10px 32px rgba(245, 108, 108, 0.6); }
      }
      @keyframes xtrtFlame {
        0%, 100% { transform: translateY(0) scale(0.9); }
        50% { transform: translateY(-2px) scale(1.15); }
      }
    `;

    const root = document.createElement('div');
    root.id = 'xtrt-root';

    const ball = document.createElement('button');
    ball.id = 'xtrt-ball';
    ball.setAttribute('aria-label', 'Open X Trending Tracker');
    ball.innerHTML = '<span class="xtrt-count">0</span><span class="xtrt-fire">🔥</span>';

    const panel = document.createElement('aside');
    panel.id = 'xtrt-panel';
    panel.innerHTML = `
      <div id="xtrt-panel-header">
        <div>
          <div id="xtrt-title">Trending Tracker</div>
          <div id="xtrt-meta">Waiting for trend data...</div>
        </div>
        <button id="xtrt-refresh" type="button">Refresh</button>
      </div>
      <ul id="xtrt-list"></ul>
    `;

    root.appendChild(ball);
    root.appendChild(panel);
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(root);

    ball.addEventListener('click', () => {
      state.panelOpen = !state.panelOpen;
      panel.classList.toggle('open', state.panelOpen);
      if (state.panelOpen) {
        clearFire();
      }
    });

    panel.querySelector('#xtrt-refresh').addEventListener('click', () => {
      refreshTrends(true);
    });
  }

  function setFire(active) {
    const ball = document.getElementById('xtrt-ball');
    if (!ball) return;
    state.fireActive = !!active;
    ball.classList.toggle('fire', state.fireActive);
  }

  function clearFire() {
    setFire(false);
  }

  function render() {
    const ball = document.getElementById('xtrt-ball');
    const panel = document.getElementById('xtrt-panel');
    if (!ball || !panel) return;

    const countNode = ball.querySelector('.xtrt-count');
    if (countNode) countNode.textContent = String(state.topics.length || 0);

    const meta = panel.querySelector('#xtrt-meta');
    if (meta) {
      if (state.lastUpdatedAt) {
        const d = new Date(state.lastUpdatedAt);
        meta.textContent = `Updated ${d.toLocaleTimeString()} • Auto every 5 min`;
      } else {
        meta.textContent = 'Waiting for trend data...';
      }
    }

    const list = panel.querySelector('#xtrt-list');
    if (!list) return;
    list.innerHTML = '';

    if (!state.topics.length) {
      const empty = document.createElement('li');
      empty.className = 'xtrt-empty';
      empty.textContent = 'No trends detected yet. Open the X home page and try refresh.';
      list.appendChild(empty);
      return;
    }

    for (const topic of state.topics) {
      const item = document.createElement('li');
      item.className = 'xtrt-item';
      item.title = 'Open trend search on X';

      const categoryColor = CATEGORY_COLORS[topic.category] || CATEGORY_COLORS.Other;
      const newBadge = (topic.isNew || topic.isTop3New) ? '<span class="xtrt-new">NEW</span>' : '';

      item.innerHTML = `
        <div class="xtrt-rank">${topic.rank}</div>
        <div>
          <div class="xtrt-name">${escapeHtml(topic.name)}</div>
          <div class="xtrt-sub">
            <span>${formatCount(topic.count)} posts</span>
            <span class="xtrt-tag" style="color:${categoryColor}">${topic.category}</span>
            ${newBadge}
          </div>
        </div>
        <div class="xtrt-velocity">${topic.velocity.icon} ${topic.velocity.label}</div>
      `;

      item.addEventListener('click', () => {
        window.open(topic.searchUrl, '_blank', 'noopener,noreferrer');
      });

      list.appendChild(item);
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function refreshTrends(force) {
    const previousSnapshot = loadPreviousSnapshot();
    const scraped = scrapeTrendsFromDOM();
    const merged = mergeWithFallback(scraped, previousSnapshot ? previousSnapshot.topics : []);
    const ranked = buildRankedTopics(merged, previousSnapshot);

    state.topics = ranked;
    state.lastUpdatedAt = Date.now();

    const hasNewTop3 = detectNewTop3(ranked);
    if (hasNewTop3 && !state.panelOpen) {
      setFire(true);
    } else if (force || state.panelOpen) {
      clearFire();
    }

    saveSnapshot({
      updatedAt: state.lastUpdatedAt,
      topics: ranked
    });

    render();
  }

  function bootFromStorage() {
    const snapshot = loadPreviousSnapshot();
    if (snapshot && Array.isArray(snapshot.topics)) {
      state.topics = snapshot.topics.slice(0, MAX_TOPICS);
      state.lastUpdatedAt = snapshot.updatedAt || 0;
    }

    const lastUrl = localStorage.getItem(STORAGE_KEYS.LAST_URL);
    if (lastUrl) state.lastUrl = lastUrl;
  }

  function startRefreshLoop() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => refreshTrends(false), REFRESH_MS);
  }

  function startUrlWatcher() {
    if (state.urlWatchTimer) clearInterval(state.urlWatchTimer);
    state.urlWatchTimer = setInterval(() => {
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        localStorage.setItem(STORAGE_KEYS.LAST_URL, state.lastUrl);
        setTimeout(() => refreshTrends(false), 1500);
      }
    }, 1000);
  }

  function startDomObserver() {
    if (state.domObserver) state.domObserver.disconnect();

    let debounce = null;
    state.domObserver = new MutationObserver(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => refreshTrends(false), 1200);
    });

    state.domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    ensureRootUI();
    bootFromStorage();
    render();
    refreshTrends(false);
    startRefreshLoop();
    startUrlWatcher();
    startDomObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
