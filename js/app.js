/**
 * Interview Framework — App Logic (config-driven)
 * 数据展示分离架构：fetch JSON → 渲染 → 交互
 * Reads all project-specific config from global APP_CONFIG object.
 */
'use strict';

// ============ State ============
const State = {
  allQuestions: [],      // 全部题目
  filtered: [],          // 当前筛选结果
  currentCategory: 'all',
  currentDifficulty: 'all',
  currentSubcategory: 'all',
  showFavoritesOnly: false,
  searchQuery: '',
  selectedTags: [],   // 选中的标签（多选筛选）
  searchHistory: JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.searchHistory') || '[]'),
  favorites: new Set(JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.favorites') || '[]')),
  viewed: new Set(JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.viewed') || '[]')),
  theme: localStorage.getItem(APP_CONFIG.storagePrefix + '.theme') || 'light',
  sortOrder: localStorage.getItem(APP_CONFIG.storagePrefix + '.sortOrder') || 'easy-first', // 'easy-first' | 'hard-first' | 'default'
};

// ============ Category Config ============
// 7 大分类，每个分类可包含多个数据文件
const CATEGORIES = APP_CONFIG.categories;

// ============ Subcategory Group Mapping (78 raw → 10 clean modules, aligned with 5 categories) ============
const SUBCAT_GROUPS = APP_CONFIG.subcatGroups;

// Reverse lookup: raw subcategory → group name
const SUBCAT_REVERSE = {};
Object.entries(SUBCAT_GROUPS).forEach(([group, subs]) => {
  subs.forEach(s => { SUBCAT_REVERSE[s] = group; });
});

function getSubcatGroup(subcategory) {
  return SUBCAT_REVERSE[subcategory] || '其他';
}

// ============ Render Category Tabs (from config) ============
function renderCategoryTabs() {
  const container = document.querySelector('.category-tabs');
  if (!container) return;
  container.innerHTML = Object.entries(CATEGORIES).map(([key, cfg]) => {
    const active = key === 'all' ? 'active' : '';
    return `<button class="category-tab ${active}" data-cat="${key}" onclick="setCategory('${key}')">${cfg.icon} ${cfg.label} <span class="count">0</span></button>`;
  }).join('');
}

// ============ Render About (from config) ============
function renderAbout() {
  const about = document.getElementById('aboutText');
  if (about && APP_CONFIG.aboutText) {
    about.innerHTML = APP_CONFIG.aboutText.replace(/\n/g, '<br>') +
      `<br><br><span style="color:var(--text-tertiary);">${APP_CONFIG.aboutTarget || ''}</span>`;
  }
}

// ============ Init ============
async function init() {
  renderCategoryTabs();
  renderAbout();
  // Set document title from config
  if (APP_CONFIG.appName) document.title = APP_CONFIG.appName + ' · 精讲';
  applyTheme();
  // Restore sort button label
  const sortLabels = {'easy-first': '↑ 由浅入深', 'hard-first': '↓ 由深入浅', 'default': '↕ 默认排序'};
  const sortBtn = document.getElementById('sortToggle');
  if (sortBtn) { sortBtn.textContent = sortLabels[State.sortOrder]; sortBtn.classList.toggle('active', State.sortOrder !== 'default'); }
  await loadAllData();
  bindEvents();
  applyFilters();
  updateProgress();
  updateStudyDashboard();
  updateReviewDashboard();
  hideLoader();
  // 深度链接：打开 #q=id 指定的题目
  openQuestionFromHash();
}

// ============ Data Loading ============
async function loadAllData() {
  const fileCatMap = {}; // fileName → categoryKey
  Object.entries(CATEGORIES).forEach(([key, cfg]) => {
    if (cfg.files) {
      cfg.files.forEach(f => { fileCatMap[f] = key; });
    }
  });
  const uniqueFiles = [...new Set(Object.keys(fileCatMap))];
  const results = await Promise.all(
    uniqueFiles.map(async (file) => {
      const res = await fetch(file);
      const data = await res.json();
      data.forEach(q => { q._category = fileCatMap[file]; });
      return data;
    })
  );
  State.allQuestions = results.flat();
  // Render category counts
  Object.entries(CATEGORIES).forEach(([key]) => {
    if (key === 'all') return;
    const count = State.allQuestions.filter(q => q._category === key).length;
    const el = document.querySelector(`[data-cat="${key}"] .count`);
    if (el) el.textContent = count;
  });
  const allEl = document.querySelector('[data-cat="all"] .count');
  if (allEl) allEl.textContent = State.allQuestions.length;
}

// ============ Rendering ============
function applyFilters() {
  State.filtered = State.allQuestions.filter(q => {
    if (State.currentCategory !== 'all' && q._category !== State.currentCategory) return false;
    if (State.currentDifficulty !== 'all' && q.difficulty !== State.currentDifficulty) return false;
    if (State.currentSubcategory !== 'all' && getSubcatGroup(q.subcategory) !== State.currentSubcategory) return false;
    if (State.showFavoritesOnly && !State.favorites.has(q.id)) return false;
    // 多标签筛选：题目必须包含所有选中的标签
    if (State.selectedTags.length > 0) {
      const hasAll = State.selectedTags.every(t => q.tags.includes(t));
      if (!hasAll) return false;
    }
    if (State.searchQuery) {
      const q_lower = State.searchQuery.toLowerCase();
      const haystack = (q.question + ' ' + q.tags.join(' ') + ' ' + q.subcategory + ' ' + q.answer).toLowerCase();
      if (!haystack.includes(q_lower)) return false;
    }
    return true;
  });
  // Difficulty sort
  const diffOrder = {'L1':1,'L2':2,'L3':3,'L4':4,'L5':5};
  if (State.sortOrder === 'easy-first') {
    State.filtered.sort((a, b) => (diffOrder[a.difficulty]||99) - (diffOrder[b.difficulty]||99));
  } else if (State.sortOrder === 'hard-first') {
    State.filtered.sort((a, b) => (diffOrder[b.difficulty]||0) - (diffOrder[a.difficulty]||0));
  }
  renderCards();
  renderSubcategoryFilter();
  renderTagFilter();
  updateStats();
}

function toggleSort() {
  const order = ['easy-first', 'hard-first', 'default'];
  const idx = order.indexOf(State.sortOrder);
  State.sortOrder = order[(idx + 1) % order.length];
  localStorage.setItem(APP_CONFIG.storagePrefix + '.sortOrder', State.sortOrder);
  const btn = document.getElementById('sortToggle');
  const labels = {'easy-first': '↑ 由浅入深', 'hard-first': '↓ 由深入浅', 'default': '↕ 默认排序'};
  btn.textContent = labels[State.sortOrder];
  btn.classList.toggle('active', State.sortOrder !== 'default');
  applyFilters();
}

function highlightSearch(text) {
  if (!State.searchQuery) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const pattern = State.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark class="search-hit">$1</mark>');
}

function tagClick(tag) {
  const input = document.getElementById('searchInput');
  input.value = tag;
  State.searchQuery = tag;
  applyFilters();
}

// ============ Virtual Scrolling / Lazy Load ============
const PAGE_SIZE = 48;       // cards per batch
State._renderedCount = 0;    // how many cards rendered so far
State._scrollObserver = null;

function buildCardHTML(q, i) {
    const cat = CATEGORIES[q._category];
    const isFav = State.favorites.has(q.id);
    const isViewed = State.viewed.has(q.id);
    const reviewItem = ReviewEngine.getItem(q.id);
    const isMastered = reviewItem && (
      (reviewItem.algo === 'leitner' && reviewItem.box >= 4) ||
      (reviewItem.algo === 'ebbinghaus' && reviewItem.phase >= 5) ||
      (reviewItem.algo === 'sm2' && reviewItem.interval >= 21)
    );
    const isDue = reviewItem && reviewItem.nextDate <= new Date().toISOString().split('T')[0];
    return `
      <div class="card" style="--card-accent: ${cat.color}; animation-delay: ${Math.min(i, 20) * 0.03}s;" onclick="openModal('${q.id}')">
        <div class="card__header">
          <span class="card__id">${q.id.toUpperCase()}</span>
          <span class="card__difficulty" data-level="${q.difficulty}">${q.difficulty}</span>
          ${isMastered ? '<span class="card__tag" style="color:var(--success);border-color:var(--success);">✓ 已掌握</span>' : ''}
          ${isDue && !isMastered ? '<span class="card__tag" style="color:var(--orange);border-color:var(--orange);">🔁 待复习</span>' : ''}
        </div>
        <div class="card__question">${highlightSearch(q.question)}</div>
        <div class="card__tags">
          ${q.tags.slice(0, 4).map(t => `<span class="card__tag" onclick="event.stopPropagation(); tagClick('${escapeHtml(t)}')" style="cursor:pointer;" title="点击筛选">${escapeHtml(t)}</span>`).join('')}
          ${q.images && q.images.length > 0 ? `<span class="card__tag" style="color:var(--info);">🖼️ ${q.images.length}</span>` : ''}
          ${isViewed ? '<span class="card__tag" style="color:var(--success);">✓ 已看</span>' : ''}
        </div>
        <button class="card__fav ${isFav ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${q.id}', this)" title="收藏">
          <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>`;
}

function renderCards() {
  const grid = document.getElementById('cardsGrid');
  if (State.filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <h3>没有找到匹配的题目</h3>
        <p>试试调整筛选条件或搜索关键词</p>
      </div>`;
    return;
  }

  // Reset lazy-load state
  State._renderedCount = 0;
  grid.innerHTML = '';

  // Render first batch
  renderMoreCards();

  // Set up IntersectionObserver for infinite scroll
  if (State._scrollObserver) State._scrollObserver.disconnect();

  const sentinel = document.createElement('div');
  sentinel.id = 'loadMoreSentinel';
  sentinel.style.height = '10px';
  grid.appendChild(sentinel);

  State._scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && State._renderedCount < State.filtered.length) {
      renderMoreCards();
    }
  }, { rootMargin: '300px' });
  State._scrollObserver.observe(sentinel);
}

function renderMoreCards() {
  const grid = document.getElementById('cardsGrid');
  const sentinel = document.getElementById('loadMoreSentinel');
  const start = State._renderedCount;
  const end = Math.min(start + PAGE_SIZE, State.filtered.length);

  const html = State.filtered.slice(start, end).map((q, i) => buildCardHTML(q, start + i)).join('');

  if (sentinel) {
    sentinel.insertAdjacentHTML('beforebegin', html);
  } else {
    grid.insertAdjacentHTML('beforeend', html);
  }

  State._renderedCount = end;

  // Show/hide load more hint
  const existingHint = document.getElementById('loadMoreHint');
  if (State._renderedCount < State.filtered.length) {
    const hintText = `滚动加载更多 · 已显示 ${State._renderedCount} / ${State.filtered.length} 题`;
    if (!existingHint && sentinel) {
      const hint = document.createElement('div');
      hint.id = 'loadMoreHint';
      hint.style.cssText = 'grid-column:1/-1;text-align:center;padding:12px;color:var(--text-tertiary);font-size:0.8125rem;';
      hint.textContent = hintText;
      sentinel.parentNode.insertBefore(hint, sentinel);
    } else if (existingHint) {
      existingHint.textContent = hintText;
    }
  } else if (existingHint) {
    existingHint.remove();
  }
}

function renderSubcategoryFilter() {
  const container = document.getElementById('subcategoryFilters');
  if (!container) return;
  // Use grouped subcategories instead of raw 78 values
  const groups = [...new Set(
    State.allQuestions
      .filter(q => State.currentCategory === 'all' || q._category === State.currentCategory)
      .map(q => getSubcatGroup(q.subcategory))
  )].sort();
  container.innerHTML = groups.map(g => {
    const count = State.allQuestions.filter(q => 
      (State.currentCategory === 'all' || q._category === State.currentCategory) &&
      getSubcatGroup(q.subcategory) === g
    ).length;
    const active = State.currentSubcategory === g ? 'active' : '';
    return `<button class="filter-chip ${active}" onclick="setSubcategory('${escapeAttr(g)}')">${escapeHtml(g)} <span style="opacity:0.5;font-size:0.625rem;">${count}</span></button>`;
  }).join('');
}

function updateStats() {
  const total = State.allQuestions.length;
  const viewed = State.viewed.size;
  const favCount = State.favorites.size;
  const filteredCount = State.filtered.length;

  const elTotal = document.getElementById('statTotal');
  const elViewed = document.getElementById('statViewed');
  const elFav = document.getElementById('statFav');
  const elShown = document.getElementById('statShown');
  if (elTotal) elTotal.textContent = total;
  if (elViewed) elViewed.textContent = viewed;
  if (elFav) elFav.textContent = favCount;
  if (elShown) elShown.textContent = filteredCount;

  // Difficulty distribution bars
  const diffCounts = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 };
  State.filtered.forEach(q => { if (diffCounts[q.difficulty] !== undefined) diffCounts[q.difficulty]++; });
  const diffEl = document.getElementById('diffBars');
  if (diffEl) {
    const max = Math.max(...Object.values(diffCounts), 1);
    diffEl.innerHTML = ['L1','L2','L3','L4','L5'].map(l => {
      const pct = (diffCounts[l] / max * 100).toFixed(0);
      return `<div class="diff-bar" data-l="${l}" style="width:${pct}%" title="${l}: ${diffCounts[l]}题"></div>`;
    }).join('');
  }
}

// ============ Modal ============
function openModal(id) {
  const q = State.allQuestions.find(x => x.id === id);
  if (!q) return;
  _currentModalIndex = State.filtered.findIndex(x => x.id === id);
  State._currentModalId = id;  // Track for lightweight close
  State.viewed.add(id);
  localStorage.setItem(APP_CONFIG.storagePrefix + '.viewed', JSON.stringify([...State.viewed]));
  updateProgress();

  const cat = CATEGORIES[q._category];
  const isFav = State.favorites.has(q.id);

  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');

  modal.innerHTML = `
    <div class="modal__swipe-hint"></div>
    <div class="modal__header">
      <div class="modal__meta">
        <span class="card__id">${q.id.toUpperCase()}</span>
        <span class="card__difficulty" data-level="${q.difficulty}">${q.difficulty}</span>
        <span class="card__tag" style="border-color:${cat.color};color:${cat.color};">${cat.icon} ${cat.label}</span>
        <span class="card__tag">${escapeHtml(getSubcatGroup(q.subcategory))}</span>
      </div>
      <h2 class="modal__question">${escapeHtml(q.question)}</h2>
      <button class="modal__close" onclick="closeModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="modal__body">
      ${q.feynman ? `
      <div class="modal__section feynman-card">
        <div class="modal__label feynman-label">📖 费曼快学</div>
        <div class="feynman-item">
          <span class="feynman-icon">🎯</span>
          <div class="feynman-content">
            <div class="feynman-sub">一句话本质</div>
            <div class="feynman-text">${escapeHtml(q.feynman.essence)}</div>
          </div>
        </div>
        <div class="feynman-item">
          <span class="feynman-icon">🧒</span>
          <div class="feynman-content">
            <div class="feynman-sub">大白话类比</div>
            <div class="feynman-text">${escapeHtml(q.feynman.analogy)}</div>
          </div>
        </div>
        ${q.feynman.key_points && q.feynman.key_points.length ? `
        <div class="feynman-item">
          <span class="feynman-icon">💡</span>
          <div class="feynman-content">
            <div class="feynman-sub">记忆要点</div>
            <ol class="feynman-list">${q.feynman.key_points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
          </div>
        </div>` : ''}
      </div>` : ''}
      <div class="modal__section">
        <div class="modal__label">📖 参考答案</div>
        <div class="modal__answer markdown-body">${renderMarkdown(q.answer)}</div>
      </div>
      ${q.first_principle ? `
      <div class="modal__section fp-card">
        <div class="modal__label fp-label">🔬 第一性原理</div>
        <div class="fp-item">
          <span class="fp-icon">❓</span>
          <div class="fp-content">
            <div class="fp-sub">根本问题</div>
            <div class="fp-text">${escapeHtml(q.first_principle.problem)}</div>
          </div>
        </div>
        ${q.first_principle.axioms && q.first_principle.axioms.length ? `
        <div class="fp-item">
          <span class="fp-icon">🧱</span>
          <div class="fp-content">
            <div class="fp-sub">基本假设</div>
            <ul class="fp-list">${q.first_principle.axioms.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
          </div>
        </div>` : ''}
        <div class="fp-item">
          <span class="fp-icon">⚙️</span>
          <div class="fp-content">
            <div class="fp-sub">从零重建</div>
            <div class="fp-text">${escapeHtml(q.first_principle.rebuild)}</div>
          </div>
        </div>
      </div>` : ''}
      ${q.images && q.images.length > 0 ? `
      <div class="modal__section">
        <div class="modal__label">🖼️ 配图 (${q.images.length})</div>
        <div class="modal__images">
          ${q.images.map((img, idx) => `<img class="modal__image" src="images/${img}" alt="${escapeAttr(img)}" loading="${idx === 0 ? 'eager' : 'lazy'}" onclick="openImageFullscreen(this)">`).join('')}
        </div>
      </div>` : ''}
      ${q.follow_up && q.follow_up.length ? `
      <div class="modal__section">
        <div class="modal__label">❓ 延伸追问</div>
        <div class="modal__followup">
          ${q.follow_up.map(f => `
            <div class="followup-item" onclick="closeModal(); searchAndOpen('${escapeAttr(f)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              ${escapeHtml(f)}
            </div>
          `).join('')}
        </div>
      </div>` : ''}
      <div class="modal__section">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="followup-item" style="flex:1;justify-content:center;" onclick="toggleFavorite('${q.id}', null); closeModal(); renderCards();">
            <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            ${isFav ? '取消收藏' : '添加收藏'}
          </button>
          <button class="followup-item" style="flex:1;justify-content:center;" onclick="copyAnswer('${q.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制答案
          </button>
          <button class="followup-item" style="flex:1;justify-content:center;" onclick="shareQuestion('${q.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            分享
          </button>
          <button class="followup-item" style="flex:1;justify-content:center;" onclick="reportQuestion('${q.id}')" title="反馈题目错误">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            报错
          </button>
        </div>
      </div>
      <div class="modal__section">
        <div class="modal__label">📝 我的笔记</div>
        <textarea class="modal__note" id="noteArea_${q.id}" placeholder="在这里记录你的理解、补充或疑问（自动保存到本地）..." oninput="saveNote('${q.id}', this.value)">${escapeHtml(getNote('${q.id}'))}</textarea>
      </div>
      <div class="modal__nav">
        <button class="modal__nav-btn" onclick="navModal(-1)" title="上一题 (←)">‹ 上一题</button>
        <span class="modal__nav-pos" id="modalNavPos"></span>
        <button class="modal__nav-btn" onclick="navModal(1)" title="下一题 (→)">下一题 ›</button>
      </div>
    </div>`;

  overlay.classList.add('active');
  // 动态更新 meta 标签 + URL hash（深度链接/SEO）
  updateMetaForQuestion(q);
  // 绑定移动端滑动关闭手势
  bindSwipeToClose();
  // 无障碍：聚焦到模态框，记录原焦点元素以便恢复
  State._lastFocused = document.activeElement;
  setTimeout(() => {
    const closeBtn = modal.querySelector('.modal__close');
    if (closeBtn) closeBtn.focus();
  }, 100);
  // Scroll modal to top — use setTimeout to ensure DOM has painted
  setTimeout(() => {
    const modalEl = document.getElementById('modal');
    if (modalEl) modalEl.scrollTop = 0;
  }, 50);
  // Update nav position
  const navPos = document.getElementById('modalNavPos');
  if (navPos && _currentModalIndex >= 0) {
    navPos.textContent = `${_currentModalIndex + 1} / ${State.filtered.length}`;
  }
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.body.style.overflow = '';
  closeImageFullscreen();
  // Light-weight update: only mark current card as viewed (no full re-render)
  if (State._currentModalId) {
    const card = document.querySelector(`[data-id="${State._currentModalId}"]`);
    if (card) card.classList.add('card--viewed');
  }
  State._currentModalId = null;
  updateStats();
  // 无障碍：恢复焦点到原元素
  if (State._lastFocused && typeof State._lastFocused.focus === 'function') {
    State._lastFocused.focus();
    State._lastFocused = null;
  }
  // 恢复默认 title（离开题目详情）
  if (APP_CONFIG.appName) document.title = APP_CONFIG.appName + ' · 精讲';
  if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
}

// ============ Swipe-to-close Gesture (移动端滑动关闭) ============
function bindSwipeToClose() {
  const modal = document.getElementById('modal');
  if (!modal || modal._swipeBound) return;
  modal._swipeBound = true;
  let startY = 0, currentY = 0, dragging = false;
  // 仅在触摸设备启用
  modal.addEventListener('touchstart', (e) => {
    // 只在模态框顶部 60px 区域（swipe-hint 附近）开始拖拽，避免影响内容滚动
    if (modal.scrollTop > 0) return;
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    if (targetEl && (targetEl.closest('.modal__header') || targetEl.classList.contains('modal__swipe-hint'))) {
      startY = touch.clientY;
      dragging = true;
      modal.style.transition = 'none';
    }
  }, { passive: true });
  modal.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const touch = e.touches[0];
    currentY = touch.clientY - startY;
    if (currentY > 0) { // 只响应向下滑
      modal.style.transform = `translateY(${currentY}px)`;
      modal.style.opacity = String(Math.max(0.3, 1 - currentY / 400));
    }
  }, { passive: true });
  modal.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    modal.style.transition = 'transform 0.25s, opacity 0.25s';
    if (currentY > 120) {
      // 下滑超过阈值 → 关闭
      closeModal();
    }
    // 重置位置
    modal.style.transform = '';
    modal.style.opacity = '';
    currentY = 0;
  }, { passive: true });
}

// ============ Image Fullscreen Viewer ============
function openImageFullscreen(img) {
  let viewer = document.getElementById('imageViewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'imageViewer';
    viewer.className = 'image-viewer';
    viewer.onclick = (e) => { if (e.target === viewer) closeImageFullscreen(); };
    document.body.appendChild(viewer);
  }
  viewer.innerHTML = `
    <button class="image-viewer__close" onclick="closeImageFullscreen()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <img class="image-viewer__img" src="${img.src}" alt="${img.alt}">
  `;
  viewer.classList.add('active');
}

function closeImageFullscreen() {
  const viewer = document.getElementById('imageViewer');
  if (viewer) viewer.classList.remove('active');
}

function searchAndOpen(query) {
  // Extract keywords from follow-up question
  const cleaned = query.replace(/[？?！!。.]/g, '').trim();
  
  // Strategy 1: Exact match
  let match = State.allQuestions.find(q => q.question === query || q.question === cleaned);
  if (match) { openModal(match.id); return; }

  // Strategy 2: Question contains the full follow-up text (or vice versa)
  match = State.allQuestions.find(q => q.question.includes(cleaned) || cleaned.includes(q.question));
  if (match) { openModal(match.id); return; }

  // Strategy 3: Extract core meaningful term and find best match
  const stopWords = new Set(['什么','是','如何','为什么','哪些','哪个','怎么','怎样','的','了','吗','呢','和','与','在','有','不','都','也','请','解释','说明','比较','区别','谈谈','概述','介绍','分析']);
  
  // Remove common question prefixes to get core term
  let core = cleaned;
  const prefixes = ['什么是','什么叫','如何','为什么','怎么','哪些','哪个','怎样','请问','简述','谈谈','请说明','请'];
  for (const p of prefixes) {
    if (core.startsWith(p)) { core = core.substring(p.length); break; }
  }
  core = core.replace(/[了吗呢啊呀吧的了吗呢]/g, '').trim();
  
  // Build candidate search terms: core + split keywords (sorted by length desc = most specific first)
  const splitKws = cleaned.split(/[\s，,、，和与的了吗呢和与在]/).filter(kw => kw.length >= 2 && !stopWords.has(kw));
  const searchTerms = [...new Set([core, ...splitKws])].filter(t => t.length >= 2).sort((a, b) => b.length - a.length);

  if (searchTerms.length > 0) {
    // Try each search term from most specific to least — open first match
    for (const term of searchTerms) {
      const termMatch = State.allQuestions.find(q => 
        q.question.includes(term) || 
        q.tags.some(t => t.includes(term)) ||
        q.subcategory.includes(term)
      );
      if (termMatch) { openModal(termMatch.id); return; }
    }
    
    // If no direct match, try pairwise: find question matching the most terms
    let bestMatch = null;
    let bestScore = 0;
    for (const q of State.allQuestions) {
      let score = 0;
      const qText = (q.question + ' ' + q.tags.join(' ') + ' ' + q.subcategory);
      for (const term of searchTerms) {
        if (qText.includes(term)) score++;
      }
      if (score > bestScore) { bestScore = score; bestMatch = q; }
    }
    if (bestMatch && bestScore >= 1) {
      openModal(bestMatch.id);
      return;
    }
  }

  // Strategy 4: Fall back to keyword search in card list
  const searchKw = searchTerms.length > 0 ? searchTerms[0] : cleaned;
  if (searchKw && searchKw.length >= 2) {
    document.getElementById('searchInput').value = searchKw;
    State.searchQuery = searchKw;
    State.currentCategory = 'all';
    State.currentDifficulty = 'all';
    document.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === 'all'));
    document.querySelectorAll('.filter-chip[data-diff]').forEach(c => c.classList.toggle('active', c.dataset.diff === 'all'));
    applyFilters();
    if (State.filtered.length > 0) {
      showToast(`🔍 搜索"${searchKw}"，共 ${State.filtered.length} 题`);
    } else {
      // Last resort: broader search with first 2 chars
      const broad = searchKw.substring(0, 2);
      document.getElementById('searchInput').value = broad;
      State.searchQuery = broad;
      applyFilters();
      showToast(`🔍 模糊搜索"${broad}"，共 ${State.filtered.length} 题`);
    }
  } else {
    showToast('未找到相关题目');
  }
}

// ============ Favorites ============
function toggleFavorite(id, btnEl) {
  if (State.favorites.has(id)) {
    State.favorites.delete(id);
  } else {
    State.favorites.add(id);
  }
  localStorage.setItem(APP_CONFIG.storagePrefix + '.favorites', JSON.stringify([...State.favorites]));
  if (btnEl) {
    const isFav = State.favorites.has(id);
    btnEl.classList.toggle('active', isFav);
    const svg = btnEl.querySelector('svg');
    if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
  }
  updateStats();
}

// ============ Progress ============
function updateProgress() {
  const total = State.allQuestions.length;
  const viewed = State.viewed.size;
  const pct = total > 0 ? Math.round((viewed / total) * 100) : 0;
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');
  if (fill) {
    const circumference = 2 * Math.PI * 24; // radius=24
    fill.style.strokeDasharray = `${(pct / 100) * circumference} ${circumference}`;
  }
  if (text) text.textContent = `${pct}%`;
}

// ============ Filters ============
function setCategory(cat) {
  State.currentCategory = cat;
  State.currentSubcategory = 'all';
  document.querySelectorAll('.category-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat);
  });
  applyFilters();
}
function setDifficulty(diff) {
  State.currentDifficulty = diff;
  document.querySelectorAll('[data-diff]').forEach(t => {
    t.classList.toggle('active', t.dataset.diff === diff);
  });
  applyFilters();
}
function setSubcategory(sub) {
  State.currentSubcategory = sub;
  applyFilters();
}
function toggleFavoritesOnly() {
  State.showFavoritesOnly = !State.showFavoritesOnly;
  const btn = document.getElementById('favFilter');
  if (btn) btn.classList.toggle('active', State.showFavoritesOnly);
  applyFilters();
}

// ============ Theme ============
function applyTheme() {
  document.documentElement.setAttribute('data-theme', State.theme);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.innerHTML = State.theme === 'dark'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
function toggleTheme() {
  State.theme = State.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(APP_CONFIG.storagePrefix + '.theme', State.theme);
  applyTheme();
}

// ============ Settings Panel ============
function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('active');
  document.getElementById('settingsOverlay').classList.toggle('active');
}

// ============ Keyboard ============
function handleKeyboard(e) {
  if (e.key === 'Escape') {
    const viewer = document.getElementById('imageViewer');
    if (viewer && viewer.classList.contains('active')) closeImageFullscreen();
    else if (document.getElementById('modalOverlay').classList.contains('active')) closeModal();
    else if (document.getElementById('settingsPanel').classList.contains('active')) toggleSettings();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
  // '/' to focus search
  if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
  // '?' to show shortcuts
  if (e.key === '?' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    toggleShortcuts();
  }
  // Arrow keys for modal navigation
  if (e.key === 'ArrowLeft' && document.getElementById('modalOverlay').classList.contains('active')) {
    navModal(-1);
  }
  if (e.key === 'ArrowRight' && document.getElementById('modalOverlay').classList.contains('active')) {
    navModal(1);
  }
  // 'L' for random question
  if ((e.key === 'l' || e.key === 'L') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    if (!StudyState.active && !ReviewState.active) randomQuestion();
  }
  // 'R' key to start review
  if (e.key === 'r' || e.key === 'R') {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (!StudyState.active && !ReviewState.active) {
        startReview();
      }
    }
  }
}

// ============ Markdown Renderer (Lightweight) ============
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Tables (must be before other transforms)
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (match, header, sep, body) => {
    const headers = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`);
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    });
    return `<table><thead><tr>${headers.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  });
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.+<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Line breaks → paragraphs
  html = html.split(/\n\n+/).map(block => {
    if (block.match(/^<(h\d|ul|ol|pre|table|blockquote)/)) return block;
    if (block.trim() === '') return '';
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

// ============ Utils ============
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
function hideLoader() {
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'none';
}

// ============ Keyboard Shortcuts Panel ============
function toggleShortcuts() {
  let panel = document.getElementById('shortcutsPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'shortcutsPanel';
    panel.className = 'shortcuts-panel';
    panel.innerHTML = `
      <div class="shortcuts-overlay" onclick="toggleShortcuts()"></div>
      <div class="shortcuts-modal">
        <h2>⌨️ 键盘快捷键</h2>
        <div class="shortcuts-grid">
          <div class="shortcut-item"><kbd>/</kbd><span>聚焦搜索框</span></div>
          <div class="shortcut-item"><kbd>Esc</kbd><span>关闭弹窗</span></div>
          <div class="shortcut-item"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><kbd>5</kbd><kbd>6</kbd><span>切换分类</span></div>
          <div class="shortcut-item"><kbd>S</kbd><span>开始刷题</span></div>
          <div class="shortcut-item"><kbd>R</kbd><span>开始复习</span></div>
          <div class="shortcut-item"><kbd>?</kbd><span>显示快捷键面板</span></div>
          <div class="shortcut-item"><kbd>L</kbd><span>随机一题</span></div>
        </div>
        <button class="shortcuts-close" onclick="toggleShortcuts()">知道了</button>
      </div>`;
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('show'));
  } else {
    panel.classList.toggle('show');
    if (!panel.classList.contains('show')) {
      setTimeout(() => { if (panel.parentNode) panel.remove(); }, 300);
    }
  }
}

// ============ Random Question ============
function randomQuestion() {
  const pool = State.filtered.length > 0 ? State.filtered : State.allQuestions;
  const q = pool[Math.floor(Math.random() * pool.length)];
  openModal(q.id);
}

// ============ Progress Export ============
function exportProgress() {
  const total = State.allQuestions.length;
  const viewed = State.viewed.size;
  const fav = State.favorites.size;
  const pct = (viewed / total * 100).toFixed(1);
  const ratings = JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.ratings') || '{}');
  const rated = Object.keys(ratings).length;
  const avgRating = rated > 0 ? (Object.values(ratings).reduce((a,b) => a+b, 0) / rated).toFixed(1) : 'N/A';
  
  const reviewData = JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.reviewItems') || '{}');
  const mastered = Object.values(reviewData).filter(r => 
    (r.algo === 'leitner' && r.box >= 4) ||
    (r.algo === 'ebbinghaus' && r.phase >= 5) ||
    (r.algo === 'sm2' && r.interval >= 21)
  ).length;
  const notesCount = Object.keys(getNotes()).length;
  
  const text = `📖 ${APP_CONFIG.appName}学习进度报告

📊 总览:
- 题库总量: ${total} 题
- 已学习: ${viewed} 题 (${pct}%)
- 已收藏: ${fav} 题
- 已评分: ${rated} 题 (平均 ${avgRating}⭐)
- 已掌握: ${mastered} 题
- 个人笔记: ${notesCount} 条

📅 生成时间: ${new Date().toLocaleString('zh-CN')}
🔗 题库地址: ${APP_CONFIG.githubUrl}${notesCount > 0 ? '\n\n' + exportNotes() : ''}`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('进度报告已复制到剪贴板！');
  }).catch(() => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'study-progress.txt';
    a.click();
  });
}

function showToast(msg) {
  let toast = document.getElementById('dynamicToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dynamicToast';
    toast.className = 'dynamic-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ============ Modal Navigation & Actions ============
function copyAnswer(id) {
  const q = State.allQuestions.find(x => x.id === id);
  if (!q) return;
  const text = `Q: ${q.question}\n\nA: ${q.answer}\n\n来源: ${APP_CONFIG.appName} (${APP_CONFIG.githubUrl})`;
  navigator.clipboard.writeText(text).then(() => {
    showToast('答案已复制到剪贴板！');
  }).catch(() => {
    showToast('复制失败，请手动选择');
  });
}

function shareQuestion(id) {
  const q = State.allQuestions.find(x => x.id === id);
  if (!q) return;
  // 生成带 hash 的深度链接，便于他人直达本题
  const url = `${APP_CONFIG.githubUrl}#q=${q.id}`;
  // 富文本分享卡片：题目 + 费曼本质（一句话） + 难度 + 来源链接
  const essence = (q.feynman && q.feynman.essence) ? q.feynman.essence.slice(0, 80) : '';
  const diff = q.difficulty || '';
  let text = `${APP_CONFIG.appName} ｜ ${diff} ${q.question}`;
  if (essence) text += `\n\n💡 ${essence}${q.feynman.essence.length > 80 ? '...' : ''}`;
  text += `\n\n🔗 ${url}`;
  if (navigator.share) {
    navigator.share({ title: `${q.question.slice(0, 40)}${q.question.length > 40 ? '...' : ''}`, text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast('分享卡片已复制（含直达链接）！'));
  }
}

// ============ Deep Linking (深度链接 #q=id) ============
function updateMetaForQuestion(q) {
  // 动态更新 meta 标签，让分享链接在社交平台有正确的预览
  if (!q) return;
  const title = `${q.question.slice(0, 50)}${q.question.length > 50 ? '...' : ''} | ${APP_CONFIG.appName}`;
  const desc = (q.feynman && q.feynman.essence) ? q.feynman.essence.slice(0, 120) : q.answer.slice(0, 120);
  document.title = title;
  const setMeta = (selector, attr, val) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, val);
  };
  setMeta('meta[name="description"]', 'content', desc);
  setMeta('meta[property="og:title"]', 'content', title);
  setMeta('meta[property="og:description"]', 'content', desc);
  setMeta('meta[name="twitter:title"]', 'content', title);
  setMeta('meta[name="twitter:description"]', 'content', desc);
  // 更新 URL hash（不触发滚动）
  if (history.replaceState) history.replaceState(null, title, `#q=${q.id}`);
}

function openQuestionFromHash() {
  const hash = location.hash;
  const m = hash.match(/^#q=(.+)$/);
  if (m && m[1]) {
    const id = decodeURIComponent(m[1]);
    // 等数据加载完
    const tryOpen = (retries) => {
      if (State.allQuestions.length > 0) {
        const q = State.allQuestions.find(x => x.id === id);
        if (q) {
          openModal(id);
        }
      } else if (retries > 0) {
        setTimeout(() => tryOpen(retries - 1), 200);
      }
    };
    tryOpen(25); // 最多等 5 秒
  }
}

// ============ Report Issue (题目纠错反馈) ============
function reportQuestion(id) {
  const q = State.allQuestions.find(x => x.id === id);
  if (!q) return;
  const repoUrl = APP_CONFIG.repoUrl || APP_CONFIG.githubUrl;
  const title = `[题目纠错] ${q.id}: ${q.question.slice(0, 50)}`;
  const body = `## 题目信息
- **题号**: ${q.id}
- **分类**: ${q.category}
- **问题**: ${q.question}

## 反馈类型
- [ ] 题目/答案有错误
- [ ] 答案不完整/截断
- [ ] 排版/公式显示异常
- [ ] 内容过时需更新
- [ ] 其他

## 详细描述
（请描述具体问题，例如哪句话有误、正确内容应该是什么）

## 原文摘录
\`\`\`
${q.answer.slice(0, 500)}
\`\`\`
`;
  const url = `${repoUrl}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=题目纠错`;
  window.open(url, '_blank');
  showToast('已打开 GitHub 反馈页，感谢您的指正！');
}

// ============ Personal Notes (个人笔记) ============
function getNotes() {
  try { return JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.notes') || '{}'); }
  catch { return {}; }
}
function saveNotes(notes) {
  localStorage.setItem(APP_CONFIG.storagePrefix + '.notes', JSON.stringify(notes));
}
function getNote(id) {
  return getNotes()[id] || '';
}
function saveNote(id, text) {
  const notes = getNotes();
  if (text && text.trim()) {
    notes[id] = text.trim();
  } else {
    delete notes[id];
  }
  saveNotes(notes);
  // Update card badge if visible
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    let badge = card.querySelector('.card__note-badge');
    if (text && text.trim()) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'card__note-badge';
        badge.textContent = '📝';
        badge.title = '有笔记';
        card.querySelector('.card__footer')?.appendChild(badge) || card.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }
  showToast(text && text.trim() ? '笔记已保存' : '笔记已删除');
}
function exportNotes() {
  const notes = getNotes();
  const count = Object.keys(notes).length;
  if (count === 0) { showToast('暂无笔记可导出'); return ''; }
  let text = `📝 ${APP_CONFIG.appName} - 我的笔记 (${count} 条)\n`;
  text += `📅 导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
  text += `${'='.repeat(50)}\n\n`;
  Object.entries(notes).forEach(([id, note]) => {
    const q = State.allQuestions.find(x => x.id === id);
    const qtext = q ? q.question : '(题目已删除)';
    text += `【${id}】${qtext}\n${note}\n\n`;
  });
  return text;
}

// ============ Wrong-Answer Book Export (错题本导出) ============
function exportWrongBook() {
  const ratings = JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.ratings') || '{}');
  // 错题 = 评为「不会」(dont) 或「模糊」(fuzzy) 的题目
  const wrong = Object.entries(ratings)
    .filter(([_, r]) => r === 'dont' || r === 'fuzzy')
    .map(([id, r]) => ({ id, rating: r }));
  const dontCount = wrong.filter(w => w.rating === 'dont').length;
  const fuzzyCount = wrong.filter(w => w.rating === 'fuzzy').length;
  if (wrong.length === 0) {
    showToast('错题本为空，去刷题标记「不会」或「模糊」吧！');
    return;
  }
  let text = `❌ ${APP_CONFIG.appName} - 我的错题本 (${wrong.length} 题)\n`;
  text += `📅 导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
  text += `📊 统计: 不会 ${dontCount} 题 / 模糊 ${fuzzyCount} 题\n`;
  text += `${'='.repeat(50)}\n\n`;
  // 按分类分组，便于针对性复习
  const byCategory = {};
  wrong.forEach(({ id, rating }) => {
    const q = State.allQuestions.find(x => x.id === id);
    if (!q) return;
    const cat = q._category || q.category || '未分类';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ id, rating, q });
  });
  Object.entries(byCategory).forEach(([cat, items]) => {
    text += `\n━━━ ${cat} (${items.length} 题) ━━━\n\n`;
    items.forEach(({ id, rating, q }) => {
      const mark = rating === 'dont' ? '❌' : '🤔';
      const label = rating === 'dont' ? '不会' : '模糊';
      text += `${mark}【${id}】[${label}] ${q.question}\n`;
      // 附带简短答案（前 150 字），方便复习
      const ans = (q.answer || '').replace(/\n+/g, ' ').slice(0, 150);
      text += `   答: ${ans}${q.answer && q.answer.length > 150 ? '...' : ''}\n\n`;
    });
  });
  text += `\n💡 建议: 优先复习「不会」的题目，配合遗忘曲线复习系统巩固。`;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`错题本已复制！共 ${wrong.length} 题`);
  }).catch(() => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `错题本-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    showToast(`错题本已下载！共 ${wrong.length} 题`);
  });
}

// ============ Tag Cloud Filter (标签云筛选) ============
function renderTagFilter() {
  const container = document.getElementById('tagFilter');
  if (!container) return;
  // 统计当前分类下的标签频次（取 Top 20）
  const tagCounts = {};
  const base = State.allQuestions.filter(q =>
    State.currentCategory === 'all' || q._category === State.currentCategory
  );
  base.forEach(q => {
    (q.tags || []).forEach(t => {
      if (t && t.length > 0) tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  // 过滤掉频次太低的标签（至少 2 题），按频次降序取 Top 20
  const topTags = Object.entries(tagCounts)
    .filter(([_, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (topTags.length === 0) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'flex';
  container.innerHTML = topTags.map(([tag, count]) => {
    const active = State.selectedTags.includes(tag);
    return `<button class="tag-chip ${active ? 'active' : ''}" onclick="toggleTag('${escapeAttr(tag)}')" title="${count} 题">
      ${escapeHtml(tag)} <span class="tag-chip__count">${count}</span>
    </button>`;
  }).join('');
  // 显示已选标签的清除按钮
  if (State.selectedTags.length > 0) {
    container.innerHTML += `<button class="tag-chip tag-chip--clear" onclick="clearTags()">✕ 清除 (${State.selectedTags.length})</button>`;
  }
}

function toggleTag(tag) {
  const idx = State.selectedTags.indexOf(tag);
  if (idx >= 0) {
    State.selectedTags.splice(idx, 1);
  } else {
    State.selectedTags.push(tag);
  }
  applyFilters();
}

function clearTags() {
  State.selectedTags = [];
  applyFilters();
}

// ============ Search History (搜索历史) ============
function saveSearchHistory(query) {
  if (!query || query.length < 2) return;
  // 去重 + 移到最前 + 最多保留 8 条
  State.searchHistory = [query, ...State.searchHistory.filter(h => h !== query)].slice(0, 8);
  localStorage.setItem(APP_CONFIG.storagePrefix + '.searchHistory', JSON.stringify(State.searchHistory));
}

function showSearchHistory() {
  const dropdown = document.getElementById('searchHistoryDropdown');
  if (!dropdown) return;
  if (State.searchHistory.length === 0) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = `
    <div class="search-history__header">
      <span>最近搜索</span>
      <button class="search-history__clear" onclick="clearSearchHistory(event)">清空</button>
    </div>
    ${State.searchHistory.map(h => `
      <div class="search-history__item" onclick="useSearchHistory('${escapeAttr(h)}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <span>${escapeHtml(h)}</span>
      </div>
    `).join('')}
  `;
  dropdown.style.display = 'block';
}

function hideSearchHistory() {
  const dropdown = document.getElementById('searchHistoryDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function useSearchHistory(query) {
  const input = document.getElementById('searchInput');
  if (input) { input.value = query; }
  State.searchQuery = query;
  hideSearchHistory();
  applyFilters();
}

function clearSearchHistory(e) {
  if (e) e.stopPropagation();
  State.searchHistory = [];
  localStorage.removeItem(APP_CONFIG.storagePrefix + '.searchHistory');
  hideSearchHistory();
  showToast('搜索历史已清空');
}

let _currentModalIndex = -1;
function navModal(dir) {
  if (_currentModalIndex < 0) return;
  const newIndex = _currentModalIndex + dir;
  if (newIndex >= 0 && newIndex < State.filtered.length) {
    closeModal();
    setTimeout(() => {
      openModal(State.filtered[newIndex].id);
      // Reset scroll after DOM update
      setTimeout(() => {
        const modalEl = document.getElementById('modal');
        if (modalEl) modalEl.scrollTop = 0;
      }, 50);
    }, 150);
  }
}

// ============ Event Binding ============
function bindEvents() {
  // Search
  const search = document.getElementById('searchInput');
  if (search) {
    let debounce;
    search.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        State.searchQuery = e.target.value.trim();
        applyFilters();
        // 输入时隐藏历史（有内容才显示结果）
        if (State.searchQuery) hideSearchHistory();
      }, 200);
    });
    // 聚焦时显示搜索历史
    search.addEventListener('focus', () => {
      if (!search.value.trim()) showSearchHistory();
    });
    // Enter 保存搜索历史
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = search.value.trim();
        if (val) { saveSearchHistory(val); hideSearchHistory(); }
      }
      if (e.key === 'Escape') { hideSearchHistory(); search.blur(); }
    });
  }
  // 点击页面其他地方关闭搜索历史
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.top-nav__search')) hideSearchHistory();
  });
  // Theme
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  // Settings
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', toggleSettings);
  const settingsOverlay = document.getElementById('settingsOverlay');
  if (settingsOverlay) settingsOverlay.addEventListener('click', toggleSettings);
  // Modal overlay click to close
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  // Progress ring click → scroll top
  const ring = document.getElementById('progressRing');
  if (ring) ring.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  // Keyboard
  document.addEventListener('keydown', handleKeyboard);
  // Study keyboard
  document.addEventListener('keydown', handleStudyKeyboard);
  document.addEventListener('keydown', handleReviewKeyboard);
  // Reset progress
  const resetBtn = document.getElementById('resetProgress');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (confirm('确定要重置学习进度吗？此操作不可撤销。')) {
      State.viewed.clear();
      localStorage.removeItem(APP_CONFIG.storagePrefix + '.viewed');
      updateProgress();
      renderCards();
      updateStats();
    }
  });
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
