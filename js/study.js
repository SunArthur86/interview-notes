/**
 * Interview Framework — Study Mode (刷题模式)
 * Flashcard-style sequential/random practice with self-assessment
 * Config-driven: reads APP_CONFIG for all project-specific values.
 */
'use strict';

// ============ Study State ============
const StudyState = {
  active: false,
  mode: 'sequential',   // 'sequential' | 'random' | 'wrong-only'
  queue: [],             // array of question IDs
  index: 0,              // current index in queue
  revealed: false,       // answer shown?
  // Self-assessment data: { questionId: 'know'|'fuzzy'|'dont' }
  ratings: JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.ratings') || '{}'),
  // Daily study log: { '2024-01-15': { studied: 10, know: 6, fuzzy: 2, dont: 2 } }
  dailyLog: JSON.parse(localStorage.getItem(APP_CONFIG.storagePrefix + '.dailyLog') || '{}'),
  // Last study date (for streak calculation)
  lastStudyDate: localStorage.getItem(APP_CONFIG.storagePrefix + '.lastStudyDate') || null,
  // Study streak days
  streak: parseInt(localStorage.getItem(APP_CONFIG.storagePrefix + '.streak') || '0'),
  // Daily goal
  dailyGoal: parseInt(localStorage.getItem(APP_CONFIG.storagePrefix + '.dailyGoal') || '20'),
  // Today's studied count
  todayCount: 0,
};

// ============ Get today's date string ============
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============ Start Study Mode ============
function startStudy(mode = 'sequential') {
  StudyState.mode = mode;
  StudyState.revealed = false;

  // Build queue based on mode
  let pool;
  if (mode === 'wrong-only') {
    // Only questions rated 'dont' or 'fuzzy'
    pool = State.allQuestions.filter(q => {
      const r = StudyState.ratings[q.id];
      return r === 'dont' || r === 'fuzzy';
    });
    if (pool.length === 0) {
      alert('🎉 错题本为空！没有需要复习的题目。');
      return;
    }
  } else {
    // Use current filtered questions
    pool = [...State.filtered];
    if (pool.length === 0) {
      alert('当前筛选条件下没有题目，请调整筛选后重试。');
      return;
    }
  }

  // Build queue
  if (mode === 'random') {
    pool = shuffleArray(pool);
  }
  StudyState.queue = pool.map(q => q.id);
  StudyState.index = 0;

  // Show study mode UI
  StudyState.active = true;
  document.getElementById('studyMode').classList.add('active');
  document.body.style.overflow = 'hidden';

  // Update mode buttons
  document.querySelectorAll('.study-topbar__mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  renderStudyCard();
  updateStudyTopbar();
}

// ============ Exit Study Mode ============
function exitStudy() {
  StudyState.active = false;
  document.getElementById('studyMode').classList.remove('active');
  document.body.style.overflow = '';
  renderCards();
  updateStats();
  updateStudyDashboard();
}

// ============ Render Study Card ============
function renderStudyCard() {
  if (StudyState.index >= StudyState.queue.length) {
    renderStudyComplete();
    return;
  }

  const qId = StudyState.queue[StudyState.index];
  const q = State.allQuestions.find(x => x.id === qId);
  if (!q) { StudyState.index++; renderStudyCard(); return; }

  const cat = CATEGORIES[q._category] || { icon: '📚', label: q._category, color: 'var(--accent)' };
  const prevRating = StudyState.ratings[q.id];
  const isFav = State.favorites.has(q.id);

  // Mark as viewed
  State.viewed.add(q.id);
  localStorage.setItem(APP_CONFIG.storagePrefix + '.viewed', JSON.stringify([...State.viewed]));

  const container = document.getElementById('studyContent');
  container.innerHTML = `
    <div class="study-card">
      <div class="study-card__meta">
        <span class="study-card__counter">${StudyState.index + 1} / ${StudyState.queue.length}</span>
        <span class="card__difficulty" data-level="${q.difficulty}">${q.difficulty}</span>
        <span class="card__tag" style="border-color:${cat.color};color:${cat.color};">${cat.icon} ${cat.label}</span>
        <span class="card__tag">${escapeHtml(q.subcategory)}</span>
        ${prevRating ? `<span class="card__tag" style="color:var(--text-tertiary);">${ratingIcon(prevRating)} ${ratingLabel(prevRating)}</span>` : ''}
      </div>

      <div class="study-card__question">${escapeHtml(q.question)}</div>

      <div class="study-card__tags">
        ${q.tags.map(t => `<span class="card__tag">${escapeHtml(t)}</span>`).join('')}
        <button class="card__tag" style="cursor:pointer;border-color:${isFav?'var(--pink)':'var(--border)'};color:${isFav?'var(--pink)':'var(--text-secondary)'};" onclick="toggleFavorite('${q.id}', null)">
          ${isFav ? '♥ 已收藏' : '♡ 收藏'}
        </button>
      </div>

      ${!StudyState.revealed ? `
        <button class="study-card__reveal-btn" onclick="revealAnswer()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          点击查看答案 <span style="opacity:0.5;">(空格键)</span>
        </button>
      ` : ''}

      <div class="study-card__answer-wrapper ${StudyState.revealed ? 'revealed' : ''}">
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

          <div class="study-card__rate ${StudyState.revealed ? 'visible' : ''}" id="rateButtons">
            <div style="width:100%;margin-bottom:8px;text-align:center;font-size:0.8125rem;color:var(--text-tertiary);">这道题你掌握得怎么样？</div>
            <button class="rate-btn" data-rate="know" onclick="rateQuestion('${q.id}','know')">
              <span class="rate-btn__icon">✅</span>
              <span class="rate-btn__label">会了</span>
              <span class="rate-btn__hint">熟练掌握</span>
            </button>
            <button class="rate-btn" data-rate="fuzzy" onclick="rateQuestion('${q.id}','fuzzy')">
              <span class="rate-btn__icon">🤔</span>
              <span class="rate-btn__label">有点模糊</span>
              <span class="rate-btn__hint">需要复习</span>
            </button>
            <button class="rate-btn" data-rate="dont" onclick="rateQuestion('${q.id}','dont')">
              <span class="rate-btn__icon">❌</span>
              <span class="rate-btn__label">不会</span>
              <span class="rate-btn__hint">加入错题本</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  updateStudyProgress();
  updateStudyTopbar();

  // Scroll to top of study content
  document.getElementById('studyContent').scrollTop = 0;
}

// ============ Reveal Answer ============
function revealAnswer() {
  StudyState.revealed = true;
  renderStudyCard();
}

// ============ Rate Question ============
function rateQuestion(qId, rating) {
  const prevRating = StudyState.ratings[qId];
  StudyState.ratings[qId] = rating;
  localStorage.setItem(APP_CONFIG.storagePrefix + '.ratings', JSON.stringify(StudyState.ratings));

  // Animate button
  const btn = document.querySelector(`[data-rate="${rating}"]`);
  if (btn) {
    btn.classList.add('rated');
    setTimeout(() => btn.classList.remove('rated'), 400);
  }

  // Update daily log
  updateDailyLog(rating, prevRating);

  // Auto-advance after a short delay
  setTimeout(() => {
    nextQuestion();
  }, 600);
}

// ============ Next / Prev ============
function nextQuestion() {
  if (StudyState.index < StudyState.queue.length - 1) {
    StudyState.index++;
    StudyState.revealed = false;
    renderStudyCard();
  } else {
    renderStudyComplete();
  }
}
function prevQuestion() {
  if (StudyState.index > 0) {
    StudyState.index--;
    StudyState.revealed = false;
    renderStudyCard();
  }
}

// ============ Study Complete ============
function renderStudyComplete() {
  const total = StudyState.queue.length;
  const rated = StudyState.queue.filter(id => StudyState.ratings[id]).length;
  const know = StudyState.queue.filter(id => StudyState.ratings[id] === 'know').length;
  const fuzzy = StudyState.queue.filter(id => StudyState.ratings[id] === 'fuzzy').length;
  const dont = StudyState.queue.filter(id => StudyState.ratings[id] === 'dont').length;
  const accuracy = rated > 0 ? Math.round((know / rated) * 100) : 0;

  document.getElementById('studyContent').innerHTML = `
    <div class="study-complete">
      <div class="study-complete__icon">${accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚'}</div>
      <h2 class="study-complete__title">本轮刷题完成！</h2>
      <p class="study-complete__desc">${accuracy >= 80 ? '表现优异！' : accuracy >= 50 ? '继续加油！错题记得复习。' : '别灰心，多刷几轮就熟了！'}</p>
      <div class="study-complete__stats">
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--accent);">${total}</div>
          <div class="study-complete__stat-label">总题数</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--success);">${know}</div>
          <div class="study-complete__stat-label">会了</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--warning);">${fuzzy}</div>
          <div class="study-complete__stat-label">模糊</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--danger);">${dont}</div>
          <div class="study-complete__stat-label">不会</div>
        </div>
        <div class="study-complete__stat">
          <div class="study-complete__stat-value" style="color:var(--purple);">${accuracy}%</div>
          <div class="study-complete__stat-label">掌握率</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
        <button class="study-nav-btn study-nav-btn--primary" onclick="startStudy('${StudyState.mode}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M22.94 14l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          再来一轮
        </button>
        ${dont > 0 || fuzzy > 0 ? `
        <button class="study-nav-btn" onclick="startStudy('wrong-only')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          只刷错题 (${dont + fuzzy})
        </button>` : ''}
        <button class="study-nav-btn" onclick="exitStudy()">
          返回列表
        </button>
      </div>
    </div>`;

  // Update bottom bar
  document.getElementById('studyBottom').innerHTML = `
    <button class="study-nav-btn study-nav-btn--primary" onclick="exitStudy()">完成，返回列表</button>`;
}

// ============ Study Progress Bar ============
function updateStudyProgress() {
  const bar = document.getElementById('studyProgressBar');
  if (!bar) return;
  const pct = StudyState.queue.length > 0
    ? ((StudyState.index + 1) / StudyState.queue.length) * 100
    : 0;
  bar.style.width = `${pct}%`;
}

// ============ Study Topbar ============
function updateStudyTopbar() {
  const title = document.getElementById('studyTitle');
  if (!title) return;
  const modeLabel = { sequential: '顺序刷题', random: '随机刷题', 'wrong-only': '错题复习' };
  title.innerHTML = `${modeLabel[StudyState.mode] || '刷题模式'} <span>(${StudyState.index + 1}/${StudyState.queue.length})</span>`;

  // Nav buttons
  const prevBtn = document.getElementById('studyPrev');
  const nextBtn = document.getElementById('studyNext');
  if (prevBtn) prevBtn.disabled = StudyState.index === 0;
  if (nextBtn) nextBtn.disabled = StudyState.index >= StudyState.queue.length - 1;
}

// ============ Daily Log ============
function updateDailyLog(rating, prevRating) {
  const today = getToday();
  if (!StudyState.dailyLog[today]) {
    StudyState.dailyLog[today] = { studied: 0, know: 0, fuzzy: 0, dont: 0 };
  }
  const log = StudyState.dailyLog[today];

  // If first time rating this question today, count it
  if (!prevRating || prevRating !== rating) {
    log.studied++;
    if (rating === 'know') log.know++;
    else if (rating === 'fuzzy') log.fuzzy++;
    else if (rating === 'dont') log.dont++;
    // Undo previous rating if existed
    if (prevRating) {
      if (prevRating === 'know') log.know = Math.max(0, log.know - 1);
      else if (prevRating === 'fuzzy') log.fuzzy = Math.max(0, log.fuzzy - 1);
      else if (prevRating === 'dont') log.dont = Math.max(0, log.dont - 1);
    }
  }

  localStorage.setItem(APP_CONFIG.storagePrefix + '.dailyLog', JSON.stringify(StudyState.dailyLog));

  // Update streak
  if (StudyState.lastStudyDate !== today) {
    // Check if yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    if (StudyState.lastStudyDate === yStr) {
      StudyState.streak++;
    } else if (StudyState.lastStudyDate !== today) {
      StudyState.streak = 1;
    }
    StudyState.lastStudyDate = today;
    localStorage.setItem(APP_CONFIG.storagePrefix + '.lastStudyDate', today);
    localStorage.setItem(APP_CONFIG.storagePrefix + '.streak', String(StudyState.streak));
  }

  StudyState.todayCount = log.studied;
}

// ============ Study Dashboard ============
function updateStudyDashboard() {
  const container = document.getElementById('studyDashboard');
  if (!container) return;

  const today = getToday();
  const todayLog = StudyState.dailyLog[today] || { studied: 0, know: 0, fuzzy: 0, dont: 0 };

  // Count wrong questions
  const wrongCount = Object.values(StudyState.ratings).filter(r => r === 'dont' || r === 'fuzzy').length;
  const knowCount = Object.values(StudyState.ratings).filter(r => r === 'know').length;
  const totalRated = wrongCount + knowCount;
  const accuracy = totalRated > 0 ? Math.round((knowCount / totalRated) * 100) : 0;

  // Daily goal progress
  const goalProgress = Math.min(100, Math.round((todayLog.studied / StudyState.dailyGoal) * 100));

  container.innerHTML = `
    <div class="study-dashboard__card" data-type="today">
      <div class="study-dashboard__icon">📅</div>
      <div class="study-dashboard__value">${todayLog.studied}</div>
      <div class="study-dashboard__label">今日刷题</div>
    </div>
    <div class="study-dashboard__card" data-type="streak">
      <div class="study-dashboard__icon">🔥</div>
      <div class="study-dashboard__value">${StudyState.streak}</div>
      <div class="study-dashboard__label">连续天数</div>
    </div>
    <div class="study-dashboard__card" data-type="accuracy">
      <div class="study-dashboard__icon">🎯</div>
      <div class="study-dashboard__value">${accuracy}%</div>
      <div class="study-dashboard__label">掌握率</div>
    </div>
    <div class="study-dashboard__card" data-type="wrong">
      <div class="study-dashboard__icon">📕</div>
      <div class="study-dashboard__value">${wrongCount}</div>
      <div class="study-dashboard__label">错题本</div>
    </div>`;

  // Daily goal bar
  const goalEl = document.getElementById('dailyGoal');
  if (goalEl) {
    goalEl.innerHTML = `
      <div class="daily-goal__icon">${goalProgress >= 100 ? '🏆' : '🎯'}</div>
      <div class="daily-goal__text">
        <div class="daily-goal__title">今日目标 ${goalProgress >= 100 ? '已达成！' : ''}</div>
        <div class="daily-goal__bar">
          <div class="daily-goal__bar-fill" style="width:${goalProgress}%;"></div>
        </div>
      </div>
      <div class="daily-goal__count">${todayLog.studied}/${StudyState.dailyGoal}</div>`;
  }
}

// ============ Study Keyboard ============
function handleStudyKeyboard(e) {
  if (!StudyState.active) return;

  // Don't interfere with text input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch(e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      nextQuestion();
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      prevQuestion();
      break;
    case ' ':
    case 'Enter':
      e.preventDefault();
      if (!StudyState.revealed) revealAnswer();
      break;
    case '1':
      if (StudyState.revealed) {
        const qId = StudyState.queue[StudyState.index];
        if (qId) rateQuestion(qId, 'know');
      }
      break;
    case '2':
      if (StudyState.revealed) {
        const qId = StudyState.queue[StudyState.index];
        if (qId) rateQuestion(qId, 'fuzzy');
      }
      break;
    case '3':
      if (StudyState.revealed) {
        const qId = StudyState.queue[StudyState.index];
        if (qId) rateQuestion(qId, 'dont');
      }
      break;
    case 'Escape':
      exitStudy();
      break;
  }
}

// ============ Helpers ============
function ratingIcon(r) {
  return r === 'know' ? '✅' : r === 'fuzzy' ? '🤔' : '❌';
}
function ratingLabel(r) {
  return r === 'know' ? '已掌握' : r === 'fuzzy' ? '需复习' : '不会';
}
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============ Settings: Adjust Daily Goal ============
function adjustDailyGoal(delta) {
  StudyState.dailyGoal = Math.max(5, Math.min(200, StudyState.dailyGoal + delta));
  localStorage.setItem(APP_CONFIG.storagePrefix + '.dailyGoal', String(StudyState.dailyGoal));
  const el = document.getElementById('dailyGoalValue');
  if (el) el.textContent = StudyState.dailyGoal;
  updateStudyDashboard();
}

// ============ Export/Import Progress ============
function exportProgress() {
  const data = {
    favorites: [...State.favorites],
    viewed: [...State.viewed],
    ratings: StudyState.ratings,
    dailyLog: StudyState.dailyLog,
    streak: StudyState.streak,
    dailyGoal: StudyState.dailyGoal,
    reviewData: ReviewEngine.load(),
    reviewAlgorithm: ReviewConfig.algorithm,
    exportDate: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${APP_CONFIG.storagePrefix}-progress-${getToday()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
