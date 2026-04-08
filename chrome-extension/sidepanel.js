/**
 * XCrab - Side Panel
 */

let allTopics = [];
let activeCategory = '';
let currentLocale = '';
let currentSort = 'heatScore';

function escapeHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatHeat(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ── i18n ── */
const labels = {
  'zh-CN': { all:'全部', noCategory:'该分类暂无热点', noTrends:'暂无热点数据', updated:'更新于', pulses:'条热点', autoTip:'每日自动刷新' },
  en: { all:'All', noCategory:'No trends in this category.', noTrends:'No trends yet.', updated:'Updated', pulses:'pulses', autoTip:'Daily auto-refresh' },
};
function t(key) { return (labels[currentLocale] || labels.en)[key] || labels.en[key]; }

/* ── Sort ── */

const sortHeatBtn = document.getElementById('sortHeat');
const sortTimeBtn = document.getElementById('sortTime');

function setSort(sort) {
  currentSort = sort;
  sortHeatBtn.classList.toggle('active', sort === 'heatScore');
  sortTimeBtn.classList.toggle('active', sort === 'createdAt');
  // Save to settings and re-fetch
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
    if (!s) return;
    s.orderBy = sort;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s });
  });
}

sortHeatBtn.addEventListener('click', () => setSort('heatScore'));
sortTimeBtn.addEventListener('click', () => setSort('createdAt'));

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
    // Delta arrow: only show for significant changes (threshold: ±0.1), no numbers
    let deltaStr = '';
    if (topic.heatDelta != null) {
      if (topic.heatDelta > 0.1) {
        deltaStr = `<span class="delta-up">↑</span>`;
      } else if (topic.heatDelta < -0.1) {
        deltaStr = `<span class="delta-down">↓</span>`;
      }
    }

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
          ${deltaStr}
          <span class="tag">${escapeHtml(topic.category)}</span>
          ${dateStr}
        </div>
      </div>
      <div class="item-right">
        <div class="heat-score">🔥 ${formatHeat(topic.heatScore)}</div>
      </div>
    `;
    div.addEventListener('click', () => {
      chrome.tabs.create({ url: topic.searchUrl });
    });
    listEl.appendChild(div);
  });
}

function updateMeta(data) {
  const metaLeft = document.querySelector('.meta-left');
  if (!metaLeft) return;
  if (!data) { metaLeft.innerHTML = '<span class="dot err"></span>No data'; return; }
  if (data.updatedAt) {
    metaLeft.innerHTML = `<span class="dot ok"></span>${t('updated')} ${formatDateTime(data.updatedAt)} · ${data.topics.length} ${t('pulses')}`;
  } else {
    metaLeft.innerHTML = '<span class="dot ok"></span>Connected';
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
      const metaLeft = document.querySelector('.meta-left');
      if (metaLeft) metaLeft.innerHTML = `<span class="dot err"></span>${escapeHtml(result.xcrabError.message)}`;
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
    document.getElementById('locale').value = s.locale || 'en-US';
    document.getElementById('limit').value = String(s.limit || 20);
    currentLocale = s.locale || '';
    currentSort = s.orderBy || 'heatScore';
    sortHeatBtn.classList.toggle('active', currentSort === 'heatScore');
    sortTimeBtn.classList.toggle('active', currentSort === 'createdAt');
  });
}

document.getElementById('saveSettings').addEventListener('click', () => {
  const settings = {
    apiBase: 'https://xcrab.net',
    locale: document.getElementById('locale').value,
    limit: parseInt(document.getElementById('limit').value, 10) || 20,
    orderBy: currentSort,
  };
  currentLocale = settings.locale;

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
    const btn = document.getElementById('saveSettings');
    btn.textContent = currentLocale === 'zh-CN' ? '已保存!' : 'Saved!';
    setTimeout(() => { btn.textContent = currentLocale === 'zh-CN' ? '保存设置' : 'Save Settings'; }, 1200);

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
