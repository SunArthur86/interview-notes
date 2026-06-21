/**
 * Interview Framework — Forgetting Curve Review System (遗忘曲线复习系统)
 * Config-driven: reads APP_CONFIG for all project-specific values.
 * 
 * Three algorithms:
 *   1. SM-2 (SuperMemo 2) — quality-based ease factor adjustment
 *   2. Leitner Box — 5-box spaced repetition with fixed intervals
 *   3. Ebbinghaus — classic curve intervals (1d, 2d, 4d, 7d, 15d, 30d)
 */
'use strict';

// ============ Review Config (user-configurable) ============
const ReviewConfig = {
  // Algorithm selection: 'sm2' | 'leitner' | 'ebbinghaus'
  algorithm: localStorage.getItem(APP_CONFIG.storagePrefix + '.reviewAlgorithm') || 'sm2',

  // --- SM-2 specific ---
  sm2: {
    initialEase: 2.5,      // starting ease factor
    minEase: 1.3,          // minimum ease factor
    easeDelta: 0.1,        // ease adjustment base
  },

  // --- Leitner box intervals (days per box, 0=box1 ... 4=box5) ---
  leitner: {
    intervals: [1, 3, 7, 14, 30],   // box→days
    maxBox: 4,
  },

  // --- Ebbinghaus classic intervals ---
  ebbinghaus: {
    intervals: [1, 2, 4, 7, 15, 30], // 6 review points
  },

  // --- Daily review limit ---
  dailyReviewLimit: parseInt(localStorage.getItem(APP_CONFIG.storagePrefix + '.dailyReviewLimit') || '50'),

  // --- Notification ---
  reviewNotification: localStorage.getItem(APP_CONFIG.storagePrefix + '.reviewNotification') !== 'false',

  // --- Auto-include new questions in review ---
  autoEnroll: localStorage.getItem(APP_CONFIG.storagePrefix + '.autoEnroll') !== 'false',

  // --- Fuzz factor (random delay to avoid clustering) ---
  fuzzEnabled: true,
};

// ============ Review Item ============
// Per-question review state stored in localStorage
// { questionId: { algo, box/phase, ease, interval, nextDate, lastDate, reps, lapses, history: [{date, quality}] } }

const ReviewEngine = {

  // ---- Storage ----
  _data: null,   // cache
  _lsKey: null,  // set in load() from APP_CONFIG

  load() {
    if (!this._lsKey) this._lsKey = APP_CONFIG.storagePrefix + '.reviewData';
    if (this._data) return this._data;
    try {
      this._data = JSON.parse(localStorage.getItem(this._lsKey) || '{}');
    } catch(e) {
      this._data = {};
    }
    return this._data;
  },

  save() {
    localStorage.setItem(this._lsKey, JSON.stringify(this._data));
  },

  // ---- Get or create item ----
  getItem(qId) {
    const data = this.load();
    if (!data[qId]) return null;
    return data[qId];
  },

  enroll(qId) {
    const data = this.load();
    if (data[qId]) return data[qId];
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const item = {
      algo: ReviewConfig.algorithm,
      // SM-2 fields
      ease: ReviewConfig.sm2.initialEase,
      interval: 0,
      reps: 0,
      lapses: 0,
      // Leitner fields
      box: 0,
      phase: 0,
      // Ebbinghaus fields (phase = which interval index)
      // Common fields
      nextDate: now,     // due immediately
      lastDate: null,
      createdAt: now,
      history: [],
    };
    data[qId] = item;
    this.save();
    return item;
  },

  // ---- Core: Process a review (rating) ----
  // quality: 0=again(blink), 1=hard, 2=good, 3=easy
  // Maps from study.js ratings: dont→0, fuzzy→1, know→2, plus new 'easy'→3
  review(qId, quality) {
    const data = this.load();
    if (!data[qId]) this.enroll(qId);
    const item = data[qId];

    const algo = item.algo || ReviewConfig.algorithm;
    const today = new Date().toISOString().split('T')[0];

    let nextInterval;

    if (algo === 'sm2') {
      nextInterval = this._sm2Calc(item, quality);
    } else if (algo === 'leitner') {
      nextInterval = this._leitnerCalc(item, quality);
    } else {
      nextInterval = this._ebbinghausCalc(item, quality);
    }

    // Apply fuzz (±10%)
    if (ReviewConfig.fuzzEnabled && nextInterval > 1) {
      nextInterval = Math.max(1, Math.round(nextInterval * (0.9 + Math.random() * 0.2)));
    }

    // Update item
    item.interval = nextInterval;
    item.lastDate = today;
    item.reps++;
    if (quality === 0) {
      item.lapses++;
      if (algo === 'leitner') item.box = Math.max(0, item.box - 1);
      if (algo === 'ebbinghaus') item.phase = 0;
    }

    // Calculate next date
    const next = new Date();
    next.setDate(next.getDate() + nextInterval);
    item.nextDate = next.toISOString().split('T')[0];

    // Record history (keep last 20)
    item.history.push({ d: today, q: quality });
    if (item.history.length > 20) item.history.shift();

    this.save();
    return item;
  },

  // ---- SM-2 Algorithm ----
  _sm2Calc(item, q) {
    // q: 0=again, 1=hard, 2=good, 3=easy
    // Map to SM-2 quality scale (0-5)
    const qMap = [1, 3, 4, 5];
    const q5 = qMap[q] !== undefined ? qMap[q] : 3;

    if (q5 < 3) {
      // Failed — reset
      item.ease = Math.max(ReviewConfig.sm2.minEase, item.ease - ReviewConfig.sm2.easeDelta);
      return 1; // see again tomorrow
    }

    // Passed — calculate
    const factor = item.ease || ReviewConfig.sm2.initialEase;
    const easeDelta = (0.1 - (5 - q5) * (0.08 + (5 - q5) * 0.02));
    item.ease = Math.max(ReviewConfig.sm2.minEase, factor + easeDelta);

    if (item.reps === 0) {
      return 1;
    } else if (item.reps === 1) {
      return 3;
    } else {
      return Math.round((item.interval || 1) * item.ease);
    }
  },

  // ---- Leitner Box Algorithm ----
  _leitnerCalc(item, q) {
    if (q === 0) {
      // Failed — go back one box
      return ReviewConfig.leitner.intervals[Math.max(0, item.box)] || 1;
    }

    // Advance box
    const newBox = Math.min(ReviewConfig.leitner.maxBox, item.box + 1);
    item.box = newBox;
    return ReviewConfig.leitner.intervals[newBox] || 30;
  },

  // ---- Ebbinghaus Curve Algorithm ----
  _ebbinghausCalc(item, q) {
    const intervals = ReviewConfig.ebbinghaus.intervals;

    if (q === 0) {
      // Failed — restart from first interval
      item.phase = 0;
      return intervals[0];
    }

    // Advance phase
    const newPhase = Math.min(intervals.length - 1, item.phase + 1);
    item.phase = newPhase;
    return intervals[newPhase];
  },

  // ---- Get due items ----
  getDueItems(allQuestions) {
    const data = this.load();
    const today = new Date().toISOString().split('T')[0];
    return allQuestions.filter(q => {
      const item = data[q.id];
      if (!item) {
        // Auto-enroll if configured
        return ReviewConfig.autoEnroll;
      }
      return item.nextDate <= today;
    });
  },

  // Get strictly due (already enrolled)
  getStrictlyDue(allQuestions) {
    const data = this.load();
    const today = new Date().toISOString().split('T')[0];
    return allQuestions.filter(q => {
      const item = data[q.id];
      return item && item.nextDate <= today;
    });
  },

  // ---- Stats ----
  getStats() {
    const data = this.load();
    const today = new Date().toISOString().split('T')[0];
    const all = Object.values(data);
    const due = all.filter(i => i.nextDate <= today).length;
    const total = all.length;
    const mastered = all.filter(i => {
      if (i.algo === 'leitner') return i.box >= 4;
      if (i.algo === 'ebbinghaus') return i.phase >= 5;
      return i.interval >= 21;
    }).length;
    const learning = total - mastered;

    // Forecast: due in next 7 days
    const forecast = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      forecast.push({
        date: ds,
        count: all.filter(item => item.nextDate === ds).length,
        dayLabel: i === 0 ? '今天' : ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()],
      });
    }

    return { due, total, mastered, learning, forecast, enrolledCount: total };
  },

  // ---- Delete item (when resetting) ----
  removeItem(qId) {
    const data = this.load();
    delete data[qId];
    this.save();
  },

  // ---- Clear all ----
  clearAll() {
    this._data = {};
    this.save();
  },

  // ---- Migrate algorithm (switch algo for all items) ----
  migrateAlgorithm(newAlgo) {
    const data = this.load();
    Object.values(data).forEach(item => {
      item.algo = newAlgo;
    });
    this.save();
  },
};

// ============ Review Mode State ============
const ReviewState = {
  active: false,
  queue: [],
  index: 0,
  revealed: false,
};

// ============ Start Review Mode ============
function startReview() {
  const due = ReviewEngine.getDueItems(State.allQuestions);

  if (due.length === 0) {
    showReviewEmpty();
    return;
  }

  // Sort: oldest-due first, then by lapses (most forgotten first)
  const data = ReviewEngine.load();
  due.sort((a, b) => {
    const ia = data[a.id], ib = data[b.id];
    if (!ia) return 1;
    if (!ib) return -1;
    if (ia.nextDate !== ib.nextDate) return ia.nextDate.localeCompare(ib.nextDate);
    return (ib.lapses || 0) - (ia.lapses || 0);
  });

  // Apply daily limit
  ReviewState.queue = due.slice(0, ReviewConfig.dailyReviewLimit).map(q => q.id);
  ReviewState.index = 0;
  ReviewState.revealed = false;
  ReviewState.active = true;

  // Reuse study mode UI
  document.getElementById('studyMode').classList.add('active');
  document.body.style.overflow = 'hidden';

  // Update topbar
  const title = document.getElementById('studyTitle');
  if (title) title.innerHTML = `🔁 遗忘曲线复习 <span>(${ReviewState.index + 1}/${ReviewState.queue.length})</span>`;

  // Hide mode buttons, show review-specific info
  document.querySelectorAll('.study-topbar__mode-btn').forEach(btn => btn.style.display = 'none');

  renderReviewCard();
  updateStudyProgress();
}

// ============ Show Review Empty ============
function showReviewEmpty() {
  const stats = ReviewEngine.getStats();
  ReviewState.active = true;
  document.getElementById('studyMode').classList.add('active');
  document.body.style.overflow = 'hidden';

  document.querySelectorAll('.study-topbar__mode-btn').forEach(btn => btn.style.display = 'none');

  document.getElementById('studyContent').innerHTML = `
    <div class="study-complete">
      <div class="study-complete__icon">✨</div>
      <h2 class="study-complete__title">今日复习已完成！</h2>
      <p class="study-complete__desc">没有到期的复习项目，做得很棒！</p>
      <div class="review-forecast">
        <div class="review-forecast__title">📅 未来 7 天复习预测</div>
        <div class="review-forecast__chart">
          ${stats.forecast.map(f => `
            <div class="review-forecast__bar-wrapper">
              <div class="review-forecast__bar" style="height:${Math.min(100, f.count * 10 + 4)}px;" title="${f.count} 题">
                ${f.count > 0 ? `<span class="review-forecast__count">${f.count}</span>` : ''}
              </div>
              <div class="review-forecast__label">${f.dayLabel}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="study-complete__stats">
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--accent);">${stats.total}</div>
          <div class="study-complete__stat-label">已加入复习</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--success);">${stats.mastered}</div>
          <div class="study-complete__stat-label">已掌握</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--warning);">${stats.learning}</div>
          <div class="study-complete__stat-label">学习中</div>
        </div>
      </div>
      <button class="study-nav-btn study-nav-btn--primary" onclick="exitReview()">返回列表</button>
    </div>`;

  document.getElementById('studyBottom').innerHTML = `
    <button class="study-nav-btn study-nav-btn--primary" onclick="exitReview()">完成</button>`;
}

// ============ Render Review Card ============
function renderReviewCard() {
  if (ReviewState.index >= ReviewState.queue.length) {
    renderReviewComplete();
    return;
  }

  const qId = ReviewState.queue[ReviewState.index];
  const q = State.allQuestions.find(x => x.id === qId);
  if (!q) { ReviewState.index++; renderReviewCard(); return; }

  const cat = CATEGORIES[q._category] || { icon: '📚', label: q._category, color: 'var(--accent)' };
  const item = ReviewEngine.getItem(q.id);
  const isFav = State.favorites.has(q.id);

  // Review meta
  const nextInterval = item ? item.interval : '?';
  const boxInfo = item ? ReviewEngine.getBoxLabel(item) : '';
  const dueDays = item ? getDaysBetween(item.nextDate, getToday()) : 0;

  State.viewed.add(q.id);
  localStorage.setItem(APP_CONFIG.storagePrefix + '.viewed', JSON.stringify([...State.viewed]));

  const container = document.getElementById('studyContent');
  container.innerHTML = `
    <div class="study-card review-card">
      <div class="study-card__meta">
        <span class="study-card__counter">${ReviewState.index + 1} / ${ReviewState.queue.length}</span>
        <span class="card__difficulty" data-level="${q.difficulty}">${q.difficulty}</span>
        <span class="card__tag" style="border-color:${cat.color};color:${cat.color};">${cat.icon} ${cat.label}</span>
        ${boxInfo ? `<span class="card__tag" style="background:var(--review-badge-bg);color:var(--review-badge-text);">${boxInfo}</span>` : ''}
        ${dueDays < 0 ? `<span class="card__tag" style="color:var(--danger);">逾期 ${Math.abs(dueDays)} 天</span>` : ''}
        ${item && item.lapses > 0 ? `<span class="card__tag" style="color:var(--text-tertiary);">🔁 ${item.lapses}次遗忘</span>` : ''}
        ${item && item.reps > 0 ? `<span class="card__tag" style="color:var(--success);">✓ 复习${item.reps}次</span>` : ''}
      </div>

      <div class="study-card__question">${escapeHtml(q.question)}</div>

      <div class="study-card__tags">
        ${q.tags.map(t => `<span class="card__tag">${escapeHtml(t)}</span>`).join('')}
        <button class="card__tag" style="cursor:pointer;border-color:${isFav?'var(--pink)':'var(--border)'};color:${isFav?'var(--pink)':'var(--text-secondary)'};" onclick="toggleFavorite('${q.id}', null)">
          ${isFav ? '♥ 已收藏' : '♡ 收藏'}
        </button>
      </div>

      ${!ReviewState.revealed ? `
        <button class="study-card__reveal-btn" onclick="revealReviewAnswer()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          点击查看答案 <span style="opacity:0.5;">(空格键)</span>
        </button>
      ` : ''}

      <div class="study-card__answer-wrapper ${ReviewState.revealed ? 'revealed' : ''}">
        <div class="study-card__answer">
          <div class="modal__label">📖 参考答案</div>
          <div class="modal__answer">${renderMarkdown(q.answer)}</div>

          ${q.follow_up && q.follow_up.length ? `
          <div style="margin-top:24px;">
            <div class="modal__label">❓ 延伸追问</div>
            <div class="modal__followup">
              ${q.follow_up.map(f => `<div class="followup-item" style="cursor:default;">${escapeHtml(f)}</div>`).join('')}
            </div>
          </div>` : ''}

          <div class="study-card__rate review-rate ${ReviewState.revealed ? 'visible' : ''}" id="rateButtons">
            <div style="width:100%;margin-bottom:8px;text-align:center;font-size:0.8125rem;color:var(--text-tertiary);">
              你记得多少？评分将决定下次复习时间
            </div>
            <button class="rate-btn rate-btn--review" data-rate="0" onclick="rateReviewQuestion('${q.id}',0)">
              <span class="rate-btn__icon">😵</span>
              <span class="rate-btn__label">完全忘了</span>
              <span class="rate-btn__hint">${getIntervalPreview(q.id, 0)}</span>
            </button>
            <button class="rate-btn rate-btn--review" data-rate="1" onclick="rateReviewQuestion('${q.id}',1)">
              <span class="rate-btn__icon">🤔</span>
              <span class="rate-btn__label">很模糊</span>
              <span class="rate-btn__hint">${getIntervalPreview(q.id, 1)}</span>
            </button>
            <button class="rate-btn rate-btn--review" data-rate="2" onclick="rateReviewQuestion('${q.id}',2)">
              <span class="rate-btn__icon">✅</span>
              <span class="rate-btn__label">记住了</span>
              <span class="rate-btn__hint">${getIntervalPreview(q.id, 2)}</span>
            </button>
            <button class="rate-btn rate-btn--review rate-btn--easy" data-rate="3" onclick="rateReviewQuestion('${q.id}',3)">
              <span class="rate-btn__icon">🌟</span>
              <span class="rate-btn__label">很轻松</span>
              <span class="rate-btn__hint">${getIntervalPreview(q.id, 3)}</span>
            </button>
          </div>

          ${item && item.history && item.history.length > 0 ? `
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="font-size:0.75rem;color:var(--text-tertiary);margin-bottom:8px;">📋 复习历史 (最近${Math.min(5, item.history.length)}次)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${item.history.slice(-5).map(h => {
                const qIcon = h.q === 0 ? '😵' : h.q === 1 ? '🤔' : h.q === 2 ? '✅' : '🌟';
                return `<span style="font-size:0.75rem;color:var(--text-tertiary);">${qIcon} ${h.d.slice(5)}</span>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>`;

  updateReviewProgress();
}

// ============ Helpers for Review ============
function getIntervalPreview(qId, quality) {
  const item = ReviewEngine.getItem(qId);
  if (!item) return '';

  // Simulate without committing
  const tempItem = JSON.parse(JSON.stringify(item));
  let interval;
  if (item.algo === 'sm2') {
    // approximate
    const qMap = [1, 3, 4, 5];
    const q5 = qMap[quality];
    if (q5 < 3) return '明天';
    if (item.reps === 0) return '1天';
    if (item.reps === 1) return '3天';
    interval = Math.round((item.interval || 1) * (item.ease || 2.5));
  } else if (item.algo === 'leitner') {
    const intervals = ReviewConfig.leitner.intervals;
    if (quality === 0) return `${intervals[Math.max(0, item.box)]}天`;
    return `${intervals[Math.min(4, item.box + 1)]}天`;
  } else {
    const intervals = ReviewConfig.ebbinghaus.intervals;
    if (quality === 0) return `${intervals[0]}天`;
    return `${intervals[Math.min(intervals.length - 1, item.phase + 1)]}天`;
  }
  return formatInterval(interval);
}

function formatInterval(days) {
  if (days <= 0) return '明天';
  if (days === 1) return '明天';
  if (days < 7) return `${days}天`;
  if (days < 30) return `${Math.round(days / 7)}周`;
  if (days < 365) return `${Math.round(days / 30)}个月`;
  return `${Math.round(days / 365)}年`;
}

function getDaysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
}

// ============ Review Actions ============
function revealReviewAnswer() {
  ReviewState.revealed = true;
  renderReviewCard();
}

function rateReviewQuestion(qId, quality) {
  ReviewEngine.review(qId, quality);

  // Also sync with study.js rating system
  const ratingMap = { 0: 'dont', 1: 'fuzzy', 2: 'know', 3: 'know' };
  StudyState.ratings[qId] = ratingMap[quality];
  localStorage.setItem(APP_CONFIG.storagePrefix + '.ratings', JSON.stringify(StudyState.ratings));
  updateDailyLog(ratingMap[quality], null);

  // Animate
  const btn = document.querySelector(`.rate-btn--review[data-rate="${quality}"]`);
  if (btn) {
    btn.classList.add('rated');
    setTimeout(() => btn.classList.remove('rated'), 400);
  }

  setTimeout(() => nextReviewQuestion(), 600);
}

function nextReviewQuestion() {
  if (ReviewState.index < ReviewState.queue.length - 1) {
    ReviewState.index++;
    ReviewState.revealed = false;
    renderReviewCard();
  } else {
    renderReviewComplete();
  }
}

function prevReviewQuestion() {
  if (ReviewState.index > 0) {
    ReviewState.index--;
    ReviewState.revealed = false;
    renderReviewCard();
  }
}

function exitReview() {
  ReviewState.active = false;
  document.getElementById('studyMode').classList.remove('active');
  document.body.style.overflow = '';
  // Restore mode buttons
  document.querySelectorAll('.study-topbar__mode-btn').forEach(btn => btn.style.display = '');
  renderCards();
  updateStats();
  updateStudyDashboard();
  updateReviewDashboard();
}

// ============ Review Complete ============
function renderReviewComplete() {
  const total = ReviewState.queue.length;
  const stats = ReviewEngine.getStats();

  document.getElementById('studyContent').innerHTML = `
    <div class="study-complete">
      <div class="study-complete__icon">🎉</div>
      <h2 class="study-complete__title">复习完成！</h2>
      <p class="study-complete__desc">本次复习了 ${total} 道题</p>
      <div class="study-complete__stats">
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--accent);">${stats.total}</div>
          <div class="study-complete__stat-label">已加入复习</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--success);">${stats.mastered}</div>
          <div class="study-complete__stat-label">已掌握</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--warning);">${stats.learning}</div>
          <div class="study-complete__stat-label">学习中</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--purple);">${stats.due}</div>
          <div class="study-complete__stat-label">仍需复习</div>
        </div>
      </div>
      <div class="review-forecast">
        <div class="review-forecast__title">📅 未来 7 天复习预测</div>
        <div class="review-forecast__chart">
          ${stats.forecast.map(f => `
            <div class="review-forecast__bar-wrapper">
              <div class="review-forecast__bar ${f.date === getToday() ? 'review-forecast__bar--today' : ''}" style="height:${Math.min(100, f.count * 10 + 4)}px;" title="${f.count} 题">
                ${f.count > 0 ? `<span class="review-forecast__count">${f.count}</span>` : ''}
              </div>
              <div class="review-forecast__label">${f.dayLabel}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
        <button class="study-nav-btn study-nav-btn--primary" onclick="exitReview()">返回列表</button>
      </div>
    </div>`;

  document.getElementById('studyBottom').innerHTML = `
    <button class="study-nav-btn study-nav-btn--primary" onclick="exitReview()">完成，返回列表</button>`;
}

// ============ Progress Bar ============
function updateReviewProgress() {
  const bar = document.getElementById('studyProgressBar');
  if (!bar) return;
  const pct = ReviewState.queue.length > 0
    ? ((ReviewState.index + 1) / ReviewState.queue.length) * 100
    : 0;
  bar.style.width = `${pct}%`;

  // Update title
  const title = document.getElementById('studyTitle');
  if (title) {
    title.innerHTML = `🔁 遗忘曲线复习 <span>(${ReviewState.index + 1}/${ReviewState.queue.length})</span>`;
  }
}

// ============ Box Label ============
ReviewEngine.getBoxLabel = function(item) {
  const algo = item.algo || ReviewConfig.algorithm;
  if (algo === 'leitner') {
    const boxNames = ['L1', 'L2', 'L3', 'L4', 'L5'];
    return `📦 Leitner ${boxNames[item.box] || 'L1'}`;
  }
  if (algo === 'ebbinghaus') {
    return `📈 第${(item.phase || 0) + 1}轮`;
  }
  // SM-2
  const ease = item.ease || 2.5;
  return `🧠 SM-2 E${ease.toFixed(1)}`;
};

// ============ Review Dashboard (on main page) ============
function updateReviewDashboard() {
  const container = document.getElementById('reviewDashboard');
  const stats = ReviewEngine.getStats();
  const dueCount = stats.due;

  // Update badge on review button
  const badge = document.getElementById('reviewDueCount');
  if (badge) {
    if (dueCount > 0) {
      badge.textContent = dueCount;
      badge.style.display = 'inline-flex';
      badge.className = 'review-due-badge review-due-count';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!container) return;

  container.innerHTML = `
    <div class="review-hero ${dueCount > 0 ? 'review-hero--due' : ''}" ${dueCount > 0 ? `onclick="startReview()" style="cursor:pointer;" role="button" tabindex="0" aria-label="${dueCount}道题需要复习，点击开始复习"` : 'aria-label="今日复习已完成"'}>
      <div class="review-hero__icon">${dueCount > 0 ? '🔔' : '✅'}</div>
      <div class="review-hero__content">
        <div class="review-hero__title">${dueCount > 0 ? `${dueCount} 道题需要复习` : '今日复习已完成'}</div>
        <div class="review-hero__desc">算法：${getAlgoLabel()} · 已掌握 ${stats.mastered} / ${stats.total}</div>
      </div>
      ${dueCount > 0 ? `
        <button class="review-hero__btn">
          开始复习 →
        </button>
      ` : ''}
    </div>

    ${stats.total > 0 ? `
    <div class="review-progress">
      <div class="review-progress__bar">
        <div class="review-progress__fill" style="width:${stats.total > 0 ? (stats.mastered / stats.total * 100) : 0}%;"></div>
      </div>
      <div class="review-progress__text">
        掌握进度 ${stats.mastered}/${stats.total} (${stats.total > 0 ? Math.round(stats.mastered / stats.total * 100) : 0}%)
      </div>
    </div>
    ` : ''}
  `;
}

function getAlgoLabel() {
  const labels = {
    'sm2': 'SM-2 智能间隔',
    'leitner': 'Leitner 卡盒',
    'ebbinghaus': '艾宾浩斯曲线',
  };
  return labels[ReviewConfig.algorithm] || labels.sm2;
}

// ============ Settings: Algorithm Selection ============
function setReviewAlgorithm(algo) {
  ReviewConfig.algorithm = algo;
  localStorage.setItem(APP_CONFIG.storagePrefix + '.reviewAlgorithm', algo);
  ReviewEngine.migrateAlgorithm(algo);
  // Update UI
  document.querySelectorAll('.algo-option').forEach(el => {
    el.classList.toggle('active', el.dataset.algo === algo);
  });
  updateReviewDashboard();
}

function setDailyReviewLimit(limit) {
  ReviewConfig.dailyReviewLimit = Math.max(5, Math.min(500, limit));
  localStorage.setItem(APP_CONFIG.storagePrefix + '.dailyReviewLimit', String(ReviewConfig.dailyReviewLimit));
  const el = document.getElementById('reviewLimitValue');
  if (el) el.textContent = ReviewConfig.dailyReviewLimit;
}

function toggleReviewNotification() {
  ReviewConfig.reviewNotification = !ReviewConfig.reviewNotification;
  localStorage.setItem(APP_CONFIG.storagePrefix + '.reviewNotification', String(ReviewConfig.reviewNotification));
  // Request permission if enabling
  if (ReviewConfig.reviewNotification && 'Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
}

function toggleAutoEnroll() {
  ReviewConfig.autoEnroll = !ReviewConfig.autoEnroll;
  localStorage.setItem(APP_CONFIG.storagePrefix + '.autoEnroll', String(ReviewConfig.autoEnroll));
}

// Reset all review data
function resetReviewData() {
  if (!confirm('确定要清空所有复习数据吗？这将删除所有复习进度，此操作不可撤销。')) return;
  ReviewEngine.clearAll();
  updateReviewDashboard();
}

// ============ Review Keyboard ============
function handleReviewKeyboard(e) {
  if (!ReviewState.active) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch(e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault(); nextReviewQuestion(); break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault(); prevReviewQuestion(); break;
    case ' ':
    case 'Enter':
      e.preventDefault();
      if (!ReviewState.revealed) revealReviewAnswer(); break;
    case '1':
      if (ReviewState.revealed) { const qId = ReviewState.queue[ReviewState.index]; if (qId) rateReviewQuestion(qId, 0); }
      break;
    case '2':
      if (ReviewState.revealed) { const qId = ReviewState.queue[ReviewState.index]; if (qId) rateReviewQuestion(qId, 1); }
      break;
    case '3':
      if (ReviewState.revealed) { const qId = ReviewState.queue[ReviewState.index]; if (qId) rateReviewQuestion(qId, 2); }
      break;
    case '4':
      if (ReviewState.revealed) { const qId = ReviewState.queue[ReviewState.index]; if (qId) rateReviewQuestion(qId, 3); }
      break;
    case 'Escape':
      exitReview(); break;
  }
}
