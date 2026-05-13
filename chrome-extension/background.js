importScripts('config.js');

/**
 * XCrab - Background Service Worker
 * Polls xcrab.net public API, caches to chrome.storage.
 */

const DEFAULT_SETTINGS = {
  locale: 'en-US',
  limit: 20,
  pulseOpenMode: 'hotPost',
};

// Get current date in YYYY-MM-DD format
function getCurrentDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

async function ensureSettings() {
  const settings = await getSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set({ xcrabSettings: settings }, resolve);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSettings();
  fetchPulses();
  // Check for updates every hour instead of every minute (daily cache strategy)
  chrome.alarms.create('poll', { periodInMinutes: 60 });
});

chrome.runtime.onStartup.addListener(() => {
  fetchPulses();
  chrome.alarms.create('poll', { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'poll') {
    // Check if we need to fetch (new day or no cache)
    fetchPulses(false);
  }
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

async function fetchPulses(forceRefresh = false) {
  chrome.storage.local.set({ xcrabPending: true });

  try {
    const currentDate = getCurrentDate();

    // Check daily cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await new Promise((resolve) => {
        chrome.storage.local.get('xcrabDailyCache', (r) => resolve(r.xcrabDailyCache));
      });

      if (cached && cached.date === currentDate && cached.allTopics && cached.allTopics.length > 0) {
        console.log('[XCrab] Using daily cache:', cached.allTopics.length, 'topics');
        await applySettingsAndDisplay(cached.allTopics);
        chrome.storage.local.set({ xcrabPending: false });
        return;
      }
    }

    // Cache miss or force refresh - fetch from API
    console.log('[XCrab] Fetching fresh data from API...');
    const s = await getSettings();
    const params = new URLSearchParams();
    params.set('limit', '100'); // Always fetch 100 items
    params.set('orderBy', 'createdAt');
    // Only force refresh on manual refresh, not on timer
    if (forceRefresh) {
      params.set('forceRefresh', 'true');
    }

    const url = `${s.apiBase}/api/pulse?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const allTopics = (json.topics || []).map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.title,
      titleEn: p.titleEn,
      titleZh: p.titleZh,
      content: p.content,
      category: p.category,
      categoryEn: p.categoryEn || p.category,
      categoryZh: p.categoryZh || p.category,
      heatScore: p.heatScore,
      heatDelta: p.heatDelta,
      createdAt: p.createdAt,
      opinionSummary: p.opinionSummary || null,
      sourceUrl: p.sourceUrl || null,
      sourceUrls: Array.isArray(p.sourceUrls) ? p.sourceUrls : (p.sourceUrl ? [p.sourceUrl] : []),
      searchUrl: p.searchUrl || `https://x.com/search?q=${encodeURIComponent(p.title)}&f=live`,
    }));

    // Save to daily cache
    await new Promise((resolve) => {
      chrome.storage.local.set({
        xcrabDailyCache: {
          date: currentDate,
          allTopics: allTopics,
          updatedAt: json.updatedAt || new Date().toISOString(),
        }
      }, resolve);
    });

    console.log('[XCrab] Cached', allTopics.length, 'topics for', currentDate);

    // Apply settings and display
    await applySettingsAndDisplay(allTopics);

    chrome.storage.local.set({
      xcrabError: null,
      xcrabPending: false,
    });

  } catch (err) {
    console.error('[XCrab] Fetch failed:', err.message);
    chrome.storage.local.set({
      xcrabError: { message: err.message, at: Date.now() },
      xcrabPending: false,
    });
  }
}

// Apply current settings to filter and display topics
async function applySettingsAndDisplay(allTopics) {
  const s = await getSettings();
  const limit = s.limit || 20;
  const category = s.category;

  // Filter by category if specified
  let filteredTopics = category
    ? allTopics.filter(t => t.category === category)
    : allTopics;

  // Limit the number of topics
  const topics = filteredTopics.slice(0, limit);

  const hasHot = topics.slice(0, 3).some(t => t.heatDelta > 0.5);

  chrome.storage.local.set({
    xcrabTrends: {
      topics,
      updatedAt: new Date().toISOString(),
      hasHot,
      fetchedAt: Date.now()
    },
  });

  if (hasHot) {
    chrome.action.setBadgeText({ text: '🔥' });
    chrome.action.setBadgeBackgroundColor({ color: '#e63e1c' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FORCE_REFRESH') {
    fetchPulses(true).then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    getSettings().then((s) => sendResponse(s));
    return true;
  }
  if (msg.type === 'SAVE_SETTINGS') {
    const nextSettings = { ...msg.settings };
    delete nextSettings.apiBase;
    chrome.storage.local.set({ xcrabSettings: nextSettings }, async () => {
      // Don't refetch - just reapply settings to cached data
      const cached = await new Promise((resolve) => {
        chrome.storage.local.get('xcrabDailyCache', (r) => resolve(r.xcrabDailyCache));
      });

      if (cached && cached.allTopics && cached.allTopics.length > 0) {
        await applySettingsAndDisplay(cached.allTopics);
        sendResponse({ success: true });
      } else {
        // No cache, fetch new data
        fetchPulses(false).then(() => sendResponse({ success: true }));
      }
    });
    return true;
  }
  if (msg.type === 'CLEAR_DAILY_CACHE') {
    chrome.storage.local.remove(['xcrabDailyCache', 'xcrabTrends'], () => {
      console.log('[XCrab] Daily cache and trends cleared');
      // Trigger fresh fetch
      fetchPulses(true).then(() => sendResponse({ success: true }));
    });
    return true;
  }
  if (msg.type === 'CLEAR_CACHE_SILENT') {
    // Clear cache without fetching (useful when backend is not running)
    chrome.storage.local.remove(['xcrabDailyCache', 'xcrabTrends'], () => {
      console.log('[XCrab] Cache cleared (silent mode - no fetch)');
      // Set empty state
      chrome.storage.local.set({
        xcrabTrends: { topics: [], updatedAt: new Date().toISOString() },
        xcrabPending: false
      });
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.type === 'CLEAR_ALL_CACHE') {
    chrome.storage.local.clear(() => {
      console.log('[XCrab] All cache cleared');
      ensureSettings();
      // Trigger fresh fetch
      fetchPulses(true).then(() => sendResponse({ success: true }));
    });
    return true;
  }
  return false;
});
