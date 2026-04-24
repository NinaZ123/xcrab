importScripts('config.js');

/**
 * XCrab - Background Service Worker
 * Polls xcrab.net public API, caches to chrome.storage.
 */

const DEFAULT_SETTINGS = {
  limit: 20,
};

async function ensureSettings() {
  const settings = await getSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set({ xcrabSettings: settings }, resolve);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSettings();
  fetchPulses();
  chrome.alarms.create('poll', { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  fetchPulses();
  chrome.alarms.create('poll', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'poll') fetchPulses();
});

async function getSettings() {
  const defaultBaseUrl = await getBaseUrl();
  return new Promise((resolve) => {
    chrome.storage.local.get('xcrabSettings', (r) =>
      resolve({
        ...DEFAULT_SETTINGS,
        ...(r.xcrabSettings || {}),
        apiBase: defaultBaseUrl,
      })
    );
  });
}

async function fetchPulses() {
  chrome.storage.local.set({ xcrabPending: true });
  try {
    const s = await getSettings();
    const params = new URLSearchParams();
    const isZh = s.locale === 'zh-CN';
    params.set('limit', String(isZh ? Math.min(s.limit || 20, 10) : (s.limit || 20)));
    params.set('orderBy', s.orderBy || 'heatScore');
    if (s.category) params.set('category', s.category);
    if (isZh) params.set('lang', 'zh');

    const url = `${s.apiBase}/api/pulse?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const topics = (json.topics || []).map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.title,
      titleEn: p.titleEn,
      content: p.content,
      category: p.category,
      heatScore: p.heatScore,
      heatDelta: p.heatDelta,
      createdAt: p.createdAt,
      opinionSummary: p.opinionSummary || null,
      sourceUrl: p.sourceUrl || null,
      sourceUrls: Array.isArray(p.sourceUrls) ? p.sourceUrls : (p.sourceUrl ? [p.sourceUrl] : []),
      searchUrl: p.searchUrl || `https://x.com/search?q=${encodeURIComponent(p.title)}&f=live`,
    }));

    const hasHot = topics.slice(0, 3).some(t => t.heatDelta > 0.5);

    chrome.storage.local.set({
      xcrabTrends: { topics, updatedAt: json.updatedAt || new Date().toISOString(), hasHot, fetchedAt: Date.now() },
      xcrabError: null,
      xcrabPending: false,
    });

    if (hasHot) {
      chrome.action.setBadgeText({ text: '🔥' });
      chrome.action.setBadgeBackgroundColor({ color: '#e63e1c' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('[XCrab] Fetch failed:', err.message);
    chrome.storage.local.set({
      xcrabError: { message: err.message, at: Date.now() },
      xcrabPending: false,
    });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FORCE_REFRESH') {
    fetchPulses().then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    getSettings().then((s) => sendResponse(s));
    return true;
  }
  if (msg.type === 'SAVE_SETTINGS') {
    const nextSettings = { ...msg.settings };
    delete nextSettings.apiBase;
    chrome.storage.local.set({ xcrabSettings: nextSettings }, () => {
      fetchPulses();
      sendResponse({ success: true });
    });
    return true;
  }
  return false;
});
