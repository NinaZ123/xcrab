/**
 * XCrab - Side Panel
 * Reads Pulse data from chrome.storage (populated by background.js).
 */

let allTopics = [];
let activeCategory = '';
let currentLocale = '';

function escapeHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatHeat(score) {
  if (!score && score !== 0) return '';
  return score >= 1000 ? `${(score/1000).toFixed(1)}k` : String(Math.round(score));
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

/* ── i18n ── */

const zhLabels = {
  all: '全部',
  loading: '加载中...',
  noCategory: '该分类暂无热点',
  noTrends: '暂无热点数据',
  updated: '更新于',
  pulses: '条热点',
  autoTip: '每日自动刷新',
  poweredBy: '由',
  poweredByEnd: '提供数据',
};

const enLabels = {
  all: 'All',
  loading: 'Loading...',
  noCategory: 'No trends in this category.',
  noTrends: 'No trends yet.',
  updated: 'Updated',
  pulses: 'pulses',
  autoTip: 'Daily auto-refresh',
  poweredBy: 'Powered by',
  poweredByEnd: '',
};

function t(key) {
  return currentLocale === 'zh-CN' ? zhLabels[key] : enLabels[key];
}

/* ── Categories ── */

function renderCategories(topics) {
  const cats = [...new Set(topics.map(t => t.category).filter(Boolean))].sort();
  const bar = document.getElementById('catBar');
  bar.innerHTML = '';

  const allChip = document.createElement('span');
  allChip.className = 'cat-chip' + (activeCategory === '' ? ' active' : '');
  allChip.textContent = t('all');
  allChip.onclick = () => { activeCategory = ''; renderCategories(allTopics); renderTrends(allTopics); };
  bar.appendChild(allChip);

  for (const cat of cats) {
    const chip = document.createElement('span');
    chip.className = 'cat-chip' + (activeCategory === cat ? ' active' : '');
    chip.textContent = cat;
    chip.onclick = () => { activeCategory = cat; renderCategories(allTopics); renderTrends(allTopics); };
    bar.appendChild(chip);
  }
}

/* ── Trends ── */

function renderTrends(topics) {
  const filtered = activeCategory ? topics.filter(t => t.category === activeCategory) : topics;
  const listEl = document.getElementById('trendList');
  const emptyEl = document.getElementById('emptyState');

  if (!filtered.length) {
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = '<div class="empty-icon">🦀</div>' + (topics.length ? t('noCategory') : t('noTrends'));
    listEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = '';

  filtered.forEach((topic, i) => {
    const deltaClass = topic.heatDelta > 0 ? 'heat-up' : 'heat-down';
    const deltaIcon = topic.heatDelta > 0 ? '↑' : topic.heatDelta < 0 ? '↓' : '→';
    const deltaStr = topic.heatDelta != null ? `<span class="${deltaClass}">${deltaIcon}${Math.abs(topic.heatDelta).toFixed(2)}</span>` : '';

    const desc = topic.content ? `<div class="desc">${escapeHtml(topic.content)}</div>` : '';
    const dateStr = topic.createdAt ? `<span class="date-label">${formatDate(topic.createdAt)}</span>` : '';

    const div = document.createElement('div');
    div.className = 'trend-item';
    div.innerHTML = `
      <div class="rank">${i + 1}</div>
      <div>
        <div class="name">${escapeHtml(topic.name)}</div>
        ${desc}
        <div class="sub">
          <span class="heat">🔥 ${formatHeat(topic.heatScore)}</span>
          ${deltaStr}
          <span class="tag">${escapeHtml(topic.category)}</span>
          ${dateStr}
        </div>
      </div>
    `;
    div.addEventListener('click', () => {
      chrome.tabs.create({ url: topic.searchUrl });
    });
    listEl.appendChild(div);
  });
}

function updateMeta(data) {
  const meta = document.getElementById('meta');
  if (!data) { meta.innerHTML = '<span class="dot err"></span>No data'; return; }
  const dot = '<span class="dot ok"></span>';
  if (data.updatedAt) {
    meta.innerHTML = `${dot}${t('updated')} ${formatDateTime(data.updatedAt)} · ${data.topics.length} ${t('pulses')}`;
  } else {
    meta.innerHTML = `${dot}Connected`;
  }
}

/* ── Load ── */

function loadTrends() {
  chrome.storage.local.get(['xcrabTrends', 'xcrabError'], (result) => {
    const data = result.xcrabTrends;
    if (data && data.topics?.length) {
      allTopics = data.topics;
      renderCategories(allTopics);
      renderTrends(allTopics);
      updateMeta(data);
    } else if (result.xcrabError) {
      document.getElementById('meta').innerHTML = `<span class="dot err"></span>${escapeHtml(result.xcrabError.message)}`;
      document.getElementById('emptyState').innerHTML = '<div class="empty-icon">⚠️</div>Cannot reach API.';
      document.getElementById('emptyState').style.display = 'block';
      document.getElementById('trendList').innerHTML = '';
    }
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.xcrabTrends) {
    const data = changes.xcrabTrends.newValue;
    if (data && data.topics?.length) {
      allTopics = data.topics;
      renderCategories(allTopics);
      renderTrends(allTopics);
      updateMeta(data);
    }
  }
});

/* ── Settings ── */

let settingsOpen = false;
const settingsToggle = document.getElementById('settingsToggle');

settingsToggle.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  document.getElementById('trendsView').style.display = settingsOpen ? 'none' : 'block';
  document.getElementById('catBar').style.display = settingsOpen ? 'none' : 'flex';
  document.getElementById('settingsPanel').classList.toggle('visible', settingsOpen);
  settingsToggle.classList.toggle('active', settingsOpen);
});

function loadSettings() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
    if (!s) return;
    document.getElementById('apiBase').value = s.apiBase || '';
    document.getElementById('apiKey').value = s.apiKey || '';
    document.getElementById('locale').value = s.locale || '';
    document.getElementById('limit').value = String(s.limit || 20);
    currentLocale = s.locale || '';
    applyLocaleUI();
  });
}

function applyLocaleUI() {
  // Update auto-refresh tooltip
  const tip = document.querySelector('.refresh-tip');
  if (tip) tip.textContent = t('autoTip');
}

document.getElementById('saveSettings').addEventListener('click', () => {
  const settings = {
    apiBase: document.getElementById('apiBase').value.replace(/\/+$/, ''),
    apiKey: document.getElementById('apiKey').value.trim(),
    locale: document.getElementById('locale').value,
    category: '',
    limit: parseInt(document.getElementById('limit').value, 10) || 20,
  };
  currentLocale = settings.locale;
  applyLocaleUI();

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
    const btn = document.getElementById('saveSettings');
    btn.textContent = currentLocale === 'zh-CN' ? '已保存!' : 'Saved!';
    setTimeout(() => { btn.textContent = currentLocale === 'zh-CN' ? '保存设置' : 'Save Settings'; }, 1200);

    // Close settings after save
    settingsOpen = false;
    document.getElementById('trendsView').style.display = 'block';
    document.getElementById('catBar').style.display = 'flex';
    document.getElementById('settingsPanel').classList.remove('visible');
    settingsToggle.classList.remove('active');
  });
});

/* ── Init ── */
loadSettings();
loadTrends();
