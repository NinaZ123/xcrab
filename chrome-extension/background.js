/**
 * XCrab - Background Service Worker
 * Polls Atypica Pulse API, caches to chrome.storage.
 */

const DEFAULT_SETTINGS = {
  apiBase: 'https://atypica.ai/api',
  apiKey: 'atypica_cdaf9e94e794715bba0663ee87b884dc26b1ac1f4d752b85083ead3cbbe3e26d',
  locale: '',       // '' = all, 'en-US', 'zh-CN'
  category: '',     // '' = all
  limit: 20,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('xcrabSettings', (r) => {
    if (!r.xcrabSettings) chrome.storage.local.set({ xcrabSettings: DEFAULT_SETTINGS });
  });
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
    params.set('limit', String(s.limit || 20));
    params.set('orderBy', 'heatDelta');
    if (s.category) params.set('category', s.category);

    const res = await fetch(`${s.apiBase}/pulse?${params}`, {
      headers: { 'Authorization': `Bearer ${s.apiKey}` },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (!json.success) throw new Error(json.message || 'API error');

    const topics = (json.data || []).map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.title,
      content: p.content,
      category: p.category,
      heatScore: p.heatScore,
      heatDelta: p.heatDelta,
      createdAt: p.createdAt,
      locale: p.locale,
      searchUrl: `https://x.com/search?q=${encodeURIComponent(p.title)}&f=live`,
    }));

    // Detect hot: any topic with heatDelta > 0.5 in top 3
    const hasHot = topics.slice(0, 3).some(t => t.heatDelta > 0.5);

    chrome.storage.local.set({
      xcrabTrends: { topics, updatedAt: new Date().toISOString(), hasHot, fetchedAt: Date.now() },
      xcrabError: null,
    });

    if (hasHot) {
      chrome.action.setBadgeText({ text: '🔥' });
      chrome.action.setBadgeBackgroundColor({ color: '#e63e1c' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    console.log(`[XCrab] Fetched ${topics.length} pulses`);
  } catch (err) {
    console.error('[XCrab] Fetch failed:', err.message);
    chrome.storage.local.set({ xcrabError: { message: err.message, at: Date.now() } });
  }
}

// Click extension icon → open side panel
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
      fetchPulses(); // re-fetch with new settings
      sendResponse({ success: true });
    });
    return true;
  }
  return false;
});
