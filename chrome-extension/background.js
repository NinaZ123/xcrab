/**
 * XCrab - Background Service Worker
 * Polls xcrab.net public API, caches to chrome.storage.
 */

const DEFAULT_SETTINGS = {
  apiBase: 'https://xcrab.net',
  limit: 20,
};

chrome.runtime.onInstalled.addListener(() => {
  // Always reset settings to ensure apiBase is correct
  chrome.storage.local.set({ xcrabSettings: DEFAULT_SETTINGS });
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
  return new Promise((resolve) => {
    chrome.storage.local.get('xcrabSettings', (r) => resolve(r.xcrabSettings || DEFAULT_SETTINGS));
  });
}

async function fetchPulses() {
  try {
    const s = await getSettings();
    const params = new URLSearchParams();
    const isZh = s.locale === 'zh-CN';
    params.set('limit', String(isZh ? Math.min(s.limit || 20, 10) : (s.limit || 20)));
    params.set('orderBy', s.orderBy || 'heatScore');
    if (s.category) params.set('category', s.category);
    if (isZh) params.set('lang', 'zh');

    const url = `${s.apiBase || 'https://xcrab.net'}/api/pulse?${params}`;
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
      searchUrl: p.searchUrl || `https://x.com/search?q=${encodeURIComponent(p.title)}&f=live`,
    }));

    const hasHot = topics.slice(0, 3).some(t => t.heatDelta > 0.5);

    chrome.storage.local.set({
      xcrabTrends: { topics, updatedAt: json.updatedAt || new Date().toISOString(), hasHot, fetchedAt: Date.now() },
      xcrabError: null,
    });

    if (hasHot) {
      chrome.action.setBadgeText({ text: '🔥' });
      chrome.action.setBadgeBackgroundColor({ color: '#e63e1c' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('[XCrab] Fetch failed:', err.message);
    chrome.storage.local.set({ xcrabError: { message: err.message, at: Date.now() } });
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
    chrome.storage.local.set({ xcrabSettings: msg.settings }, () => {
      fetchPulses();
      sendResponse({ success: true });
    });
    return true;
  }
  return false;
});
