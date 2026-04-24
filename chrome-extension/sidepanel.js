/**
 * XCrab - Side Panel
 */

let allTopics = [];
let activeCategory = '';
let currentLocale = '';
let currentSort = 'heatScore';
let dialogTopic = null;
let isPending = false;

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
  'zh-CN': {
    all:'全部',
    noCategory:'该分类暂无热点',
    noTrends:'暂无热点数据',
    updated:'更新于',
    pulses:'条热点',
    autoTip:'每日自动刷新',
    sourcePosts:'原帖',
    chooseSource:'选择要打开的原帖',
    opinionTrend:'舆论趋势',
    keyViewpoints:'关键观点',
    controversies:'争议点',
    overallSentiment:'整体情绪',
    noOpinion:'暂无舆论摘要',
    showSourcePost:'显示原帖',
    showSourcePostN:'显示原帖',
    loading:'加载中...',
    switching:'切换中...',
    saving:'保存中...',
    saveSettings:'保存设置',
    saved:'已保存!',
    sortBy:'排序',
    hot:'🔥 热门',
    newest:'🕐 最新',
    originalPosts:'原帖列表',
    cannotReachApi:'无法连接接口。',
    noSourcePosts:'暂无原帖',
    connected:'已连接',
  },
  en: {
    all:'All',
    noCategory:'No trends in this category.',
    noTrends:'No trends yet.',
    updated:'Updated',
    pulses:'pulses',
    autoTip:'Daily auto-refresh',
    sourcePosts:'Source posts',
    chooseSource:'Choose which source post to open',
    opinionTrend:'Opinion Trend',
    keyViewpoints:'Key Viewpoints',
    controversies:'Controversies',
    overallSentiment:'Overall Sentiment',
    noOpinion:'No opinion summary available.',
    showSourcePost:'Show source post',
    showSourcePostN:'Show source post',
    loading:'Loading...',
    switching:'Switching...',
    saving:'Saving...',
    saveSettings:'Save Settings',
    saved:'Saved!',
    sortBy:'Sort by',
    hot:'🔥 Hot',
    newest:'🕐 New',
    originalPosts:'Original Posts',
    cannotReachApi:'Cannot reach API.',
    noSourcePosts:'No source posts available.',
    connected:'Connected',
  },
};
function t(key) { return (labels[currentLocale] || labels.en)[key] || labels.en[key]; }

const sourceDialogBackdrop = document.getElementById('sourceDialogBackdrop');
const sourceDialogClose = document.getElementById('sourceDialogClose');
const sourceDialogTitle = document.getElementById('sourceDialogTitle');
const sourceDialogSubtitle = document.getElementById('sourceDialogSubtitle');
const sourceDialogSectionTitle = document.getElementById('sourceDialogSectionTitle');
const sourceDialogDescription = document.getElementById('sourceDialogDescription');
const sourceDialogOpinion = document.getElementById('sourceDialogOpinion');
const sourceDialogList = document.getElementById('sourceDialogList');
const refreshLabel = document.getElementById('refreshLabel');
const refreshTip = document.getElementById('refreshTip');
const sortLabel = document.getElementById('sortLabel');
const saveSettingsButton = document.getElementById('saveSettings');
const metaLeft = document.querySelector('.meta-left');

function renderOpinionPanel(opinionSummary) {
  if (!sourceDialogOpinion) return;

  if (!opinionSummary || (!opinionSummary.summary && !opinionSummary.overallSentiment && !opinionSummary.keyViewpoints?.length && !opinionSummary.controversies?.length)) {
    sourceDialogOpinion.innerHTML = `
      <div class="opinion-header">
        <div class="opinion-panel-title">${escapeHtml(t('opinionTrend'))}</div>
      </div>
      <div class="opinion-main">${escapeHtml(t('noOpinion'))}</div>
    `;
    return;
  }

  const summary = opinionSummary.summary ? `<div class="opinion-main">${escapeHtml(opinionSummary.summary)}</div>` : '';
  const sentiment = opinionSummary.overallSentiment
    ? `<div class="sentiment-badge">${escapeHtml(`${t('overallSentiment')}: ${opinionSummary.overallSentiment}`)}</div>`
    : '';
  const viewpoints = Array.isArray(opinionSummary.keyViewpoints) && opinionSummary.keyViewpoints.length > 0
    ? opinionSummary.keyViewpoints.map((item) => `
        <div class="viewpoint-card">
          ${item?.stance ? `<div class="viewpoint-stance">${escapeHtml(item.stance)}</div>` : ''}
          <div class="viewpoint-summary">${escapeHtml(item?.summary || '')}</div>
        </div>
      `).join('')
    : `<div class="viewpoint-summary">${escapeHtml(t('noOpinion'))}</div>`;
  const controversies = Array.isArray(opinionSummary.controversies) && opinionSummary.controversies.length > 0
    ? `<ul class="controversy-list">${opinionSummary.controversies.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : `<div class="viewpoint-summary">${escapeHtml(t('noOpinion'))}</div>`;

  sourceDialogOpinion.innerHTML = `
    <div class="opinion-header">
      <div class="opinion-panel-title">${escapeHtml(t('opinionTrend'))}</div>
      ${sentiment}
    </div>
    ${summary}
    <div class="opinion-grid">
      <div>
        <div class="opinion-column-title">${escapeHtml(t('keyViewpoints'))}</div>
        <div class="viewpoint-list">${viewpoints}</div>
      </div>
      <div>
        <div class="opinion-column-title">${escapeHtml(t('controversies'))}</div>
        ${controversies}
      </div>
    </div>
  `;
}

function closeSourceDialog() {
  dialogTopic = null;
  sourceDialogBackdrop.classList.remove('visible');
}

function updateStaticText() {
  if (refreshLabel) refreshLabel.textContent = 'Auto';
  if (refreshTip) refreshTip.textContent = t('autoTip');
  if (sortLabel) sortLabel.textContent = t('sortBy');
  if (sortHeatBtn) sortHeatBtn.textContent = t('hot');
  if (sortTimeBtn) sortTimeBtn.textContent = t('newest');
  if (sourceDialogSectionTitle) sourceDialogSectionTitle.textContent = t('originalPosts');
  if (saveSettingsButton && !isPending) saveSettingsButton.textContent = t('saveSettings');
}

function setPendingState(pending) {
  isPending = pending;
  if (metaLeft) {
    metaLeft.classList.toggle('pending', pending);
    metaLeft.innerHTML = pending
      ? `<span class="spinner"></span>${escapeHtml(t('switching'))}`
      : metaLeft.innerHTML;
  }
  if (saveSettingsButton) {
    saveSettingsButton.disabled = pending;
    saveSettingsButton.textContent = pending ? t('saving') : t('saveSettings');
    saveSettingsButton.style.opacity = pending ? '0.7' : '1';
    saveSettingsButton.style.cursor = pending ? 'wait' : 'pointer';
  }
}

function openSourceDialog(topic) {
  dialogTopic = topic;
  const sourceUrls = Array.isArray(topic.sourceUrls) ? topic.sourceUrls : [];
  sourceDialogTitle.textContent = topic.name || t('sourcePosts');
  sourceDialogSubtitle.textContent = t('chooseSource');
  sourceDialogDescription.textContent = topic.content || '';
  renderOpinionPanel(topic.opinionSummary);
  sourceDialogList.innerHTML = '';

  if (sourceUrls.length > 0) {
    sourceUrls.forEach((url, index) => {
      const link = document.createElement('a');
      link.className = 'source-link';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.innerHTML = `
        <div class="source-index">${escapeHtml(`${t('showSourcePost')} ${index + 1}`)}</div>
        <div class="source-url">${escapeHtml(url)}</div>
      `;
      sourceDialogList.appendChild(link);
    });
  } else {
    sourceDialogList.innerHTML = `<div class="viewpoint-summary">${escapeHtml(t('noSourcePosts'))}</div>`;
  }

  sourceDialogBackdrop.classList.add('visible');
}

sourceDialogClose.addEventListener('click', closeSourceDialog);
sourceDialogBackdrop.addEventListener('click', (event) => {
  if (event.target === sourceDialogBackdrop) closeSourceDialog();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dialogTopic) closeSourceDialog();
});

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
      openSourceDialog(topic);
    });
    listEl.appendChild(div);
  });
}

function updateMeta(data) {
  if (!metaLeft) return;
  if (isPending) return;
  if (!data) { metaLeft.innerHTML = '<span class="dot err"></span>No data'; return; }
  if (data.updatedAt) {
    metaLeft.innerHTML = `<span class="dot ok"></span>${t('updated')} ${formatDateTime(data.updatedAt)} · ${data.topics.length} ${t('pulses')}`;
  } else {
    metaLeft.innerHTML = `<span class="dot ok"></span>${escapeHtml(t('connected'))}`;
  }
}

/* ── Load ── */

function loadTrends() {
  chrome.storage.local.get(['xcrabTrends', 'xcrabError', 'xcrabPending'], (result) => {
    setPendingState(Boolean(result.xcrabPending));
    const data = result.xcrabTrends;
    if (data && data.topics?.length) {
      allTopics = data.topics;
      renderCategories(allTopics);
      renderTrends(allTopics);
      updateMeta(data);
    } else if (result.xcrabError) {
      if (metaLeft) metaLeft.innerHTML = `<span class="dot err"></span>${escapeHtml(result.xcrabError.message)}`;
      document.getElementById('emptyState').innerHTML = `<div class="empty-icon">⚠️</div>${escapeHtml(t('cannotReachApi'))}`;
      document.getElementById('emptyState').style.display = 'block';
      document.getElementById('trendList').innerHTML = '';
    } else if (result.xcrabPending) {
      document.getElementById('emptyState').innerHTML = `<div class="empty-icon">🦀</div>${escapeHtml(t('loading'))}`;
      document.getElementById('emptyState').style.display = 'block';
      document.getElementById('trendList').innerHTML = '';
    }
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.xcrabPending) {
    setPendingState(Boolean(changes.xcrabPending.newValue));
    if (changes.xcrabPending.newValue) {
      document.getElementById('emptyState').innerHTML = `<div class="empty-icon">🦀</div>${escapeHtml(t('loading'))}`;
      document.getElementById('emptyState').style.display = 'block';
      document.getElementById('trendList').innerHTML = '';
    } else if (allTopics.length) {
      renderCategories(allTopics);
      renderTrends(allTopics);
    }
  }
  if (changes.xcrabTrends) {
    const data = changes.xcrabTrends.newValue;
    if (data && data.topics?.length) {
      allTopics = data.topics;
      renderCategories(allTopics);
      renderTrends(allTopics);
      updateMeta(data);
    }
  }
  if (changes.xcrabError && changes.xcrabError.newValue && !isPending) {
    if (metaLeft) metaLeft.innerHTML = `<span class="dot err"></span>${escapeHtml(changes.xcrabError.newValue.message)}`;
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
    updateStaticText();
  });
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, async (currentSettings) => {
    const settings = {
      ...(currentSettings || {}),
      apiBase: currentSettings?.apiBase || await getBaseUrl(),
      locale: document.getElementById('locale').value,
      limit: parseInt(document.getElementById('limit').value, 10) || 20,
      orderBy: currentSort,
    };
    currentLocale = settings.locale;
    updateStaticText();
    setPendingState(true);

    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
      saveSettingsButton.textContent = t('saved');
      setTimeout(() => {
        if (!isPending) saveSettingsButton.textContent = t('saveSettings');
      }, 1200);

      settingsOpen = false;
      document.getElementById('trendsView').style.display = 'block';
      document.getElementById('catBar').style.display = 'flex';
      document.getElementById('settingsPanel').classList.remove('visible');
      settingsToggle.classList.remove('active');
      loadTrends();
    });
  });
});

/* ── Init ── */
loadSettings();
loadTrends();
