// ===================== CANVAS =====================
const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
// scale applied each frame via setTransform(20,0,0,20,0,0)

const nextCanvas = document.getElementById('next-piece');
const nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;
const holdCanvas = document.getElementById('hold-piece');
const holdCtx = holdCanvas ? holdCanvas.getContext('2d') : null;
if (nextCtx) nextCtx.imageSmoothingEnabled = false;
if (holdCtx) holdCtx.imageSmoothingEnabled = false;

// ===================== STATE =====================
let score = 0;
let highScore = 0;
let balance = 0;
try { localStorage.removeItem('tetrisSession'); } catch(e) {} // BOOT_CLEAR_SESSION
// seasonClaimed declared above
// caseAvailableAt declared above
let level = 1;
let linesCleared = 0;
let dropInterval = 1000;
let lastTime = 0;
let dropCounter = 0;
let paused = false;
let gameOver = false;
let combo = 0;
let gameMode = 'classic'; // classic | sprint | zen | hunger
let sprintTarget = 100;
let sprintStart = 0;
let sprintElapsed = 0;
let holdMatrix = null;
let holdLocked = false;
let particles = [];
let shakeTime = 0;
let softDropping = false;
let lastRotateWasKick = false;
let hungerTimer = 0;
let hungerInterval = 12000;
let duelId = null;
let duelOppScore = 0;
let duelUnsub = null;
let lineFlashRows = [];
let lineFlashTime = 0;
let currentUser = null; // { login, uid }
let presenceRef = null;
let dbRef = null;
let firebaseReady = false;
let inviteUnsub = null;
function getDeviceId() {
  let id = localStorage.getItem('tetrisDeviceId');
  if (!id) {
    id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('tetrisDeviceId', id);
  }
  return id;
}
function fbKey(s) {
  return String(s || 'x').replace(/[.#$\[\]\/]/g, '_');
}

// Settings
const settings = Object.assign({
  sound: true, vibrate: true, ghost: true, skin: 'classic', das: 250
}, JSON.parse(localStorage.getItem('tetrisSettings') || '{}'));

function saveSettings() {
  localStorage.setItem('tetrisSettings', JSON.stringify(settings));
}

// ===================== CLOUD USER DATA =====================
function defaultUserData() {
  return {
    highScore: 0,
    highScores: { classic: 0, sprint: 0, duel: 0 },
    balance: 0,
    bought: {},
    stats: {
      totalLines: 0, bestScore: 0, tetrises: 0, maxCombo: 0,
      maxLevel: 1, sprints: 0, themesBought: 0, casesOpened: 0,
      tspins: 0, hungerLines: 0, gamesPlayed: 0, duelWins: 0, unlocked: {}
    },
    quests: null,
    seasonClaimed: {},
    caseAvailableAt: 0,
    updatedAt: Date.now()
  };
}

let highScores = { classic: 0, sprint: 0, duel: 0 };

function modeRecordKey(mode) {
  if (mode === 'sprint') return 'sprint';
  if (mode === 'duel') return 'duel';
  return 'classic';
}

function getModeHigh(mode) {
  const k = modeRecordKey(mode || gameMode);
  return (highScores && highScores[k]) || 0;
}

function setModeHigh(mode, value) {
  const k = modeRecordKey(mode || gameMode);
  if (!highScores) highScores = { classic: 0, sprint: 0, duel: 0 };
  highScores[k] = value;
  if (k === 'classic') highScore = value; // legacy field
}

function applyUserData(data) {
  // hard reset first so previous account never leaks
  highScore = 0;
  highScores = { classic: 0, sprint: 0, duel: 0 };
  balance = 0;
  themes.forEach(t => { bought[t] = false; active[t] = false; });
  stats = defaultUserData().stats;
  seasonClaimed = {};
  caseAvailableAt = 0;
  quests = {
    date: todayKey(),
    ver: 2,
    items: QUEST_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 10).map(q => ({ ...q, progress: 0, claimed: false }))
  };

  data = data || defaultUserData();
  highScores = Object.assign({ classic: 0, sprint: 0, duel: 0 }, data.highScores || {});
  // migrate old single highScore
  if (data.highScore && !highScores.classic) highScores.classic = data.highScore;
  highScore = highScores.classic || 0;
  balance = data.balance || 0;
  const b = data.bought || {};
  themes.forEach(t => { bought[t] = !!b[t]; });
  stats = Object.assign(defaultUserData().stats, data.stats || {});
  if (!stats.unlocked) stats.unlocked = {};
  seasonClaimed = data.seasonClaimed || {};
  caseAvailableAt = data.caseAvailableAt || 0;
  if (data.quests && data.quests.date === todayKey() && data.quests.items) {
    quests = data.quests;
  }
  updateScore();
  updateBalance();
  updateProfileUI();
  updateCaseTimer();
  try { renderShop && renderShop(); } catch(e) {}
}

async function loadUserData(uid) {
  if (!dbRef || !uid) {
    applyUserData(defaultUserData());
    return;
  }
  try {
    const snap = await dbRef.ref('/userdata/' + fbKey(uid)).once('value');
    const data = snap.val();
    applyUserData(data || defaultUserData());
  } catch (e) {
    console.warn('loadUserData', e);
    applyUserData(defaultUserData());
  }
}

let _saveCloudTimer = null;
function saveUserData() {
  if (!currentUser || currentUser.guest || !dbRef) return;
  const payload = {
    highScore: highScores.classic || highScore || 0,
    highScores: Object.assign({ classic: 0, sprint: 0, duel: 0 }, highScores),
    balance,
    bought: Object.assign({}, bought),
    stats,
    quests,
    seasonClaimed,
    caseAvailableAt,
    updatedAt: Date.now()
  };
  // debounce writes
  clearTimeout(_saveCloudTimer);
  _saveCloudTimer = setTimeout(() => {
    dbRef.ref('/userdata/' + fbKey(currentUser.uid)).set(payload).catch(e => console.warn('saveUserData', e));
  }, 400);
}



const SKINS = {
  classic: [null, '#FF0D72', '#0DC2FF', '#0DFF72', '#F538FF', '#FF8E0D', '#FFE138', '#3877FF'],
  neon:    [null, '#ff00aa', '#00f0ff', '#39ff14', '#bf00ff', '#ff6b00', '#ffff00', '#00a2ff'],
  glass:   [null, '#f9a8d4', '#a5f3fc', '#bbf7d0', '#e9d5ff', '#fed7aa', '#fef08a', '#bfdbfe'],
  pastel:  [null, '#f472b6', '#67e8f9', '#86efac', '#c4b5fd', '#fdba74', '#fde047', '#93c5fd'],
  mono:    [null, '#e2e8f0', '#cbd5e1', '#94a3b8', '#f1f5f9', '#64748b', '#e2e8f0', '#cbd5e1'],
};
let colors = SKINS[settings.skin] || SKINS.classic;

// ===================== THEMES =====================
const themes = [
  'theme','chipmunk','glent','billy','pidors','bosinn','billyv2','edit',
  'gigachad','maga','sneakedup','goblingang','sexibetmen','sigma',
  'ricardomillos','trollface','kobyakov','chipichapa','whatsapp','rickroll','billyv3','repo','dance','dante','josh','repov2','tvorog','chicken','billyv4','music','crocodile','dantev2','rooster','goose','musicv2','romapro','creeper','roosterv2','toilet','ratdance','kingvon','musicv3','breto','roosterv3','mactraher','legday','laser','dragon','trollfacev2','endoskeleton'
];
const bought = {};
const active = {};
const savedBought = JSON.parse(localStorage.getItem('tetrisBought') || '{}');
themes.forEach(t => { bought[t] = !!savedBought[t]; active[t] = false; });

// ===================== ACHIEVEMENTS =====================
const ACHIEVEMENTS = [
  { id: 'first_line', name: 'Первая линия', desc: 'Очисти 1 линию', check: s => s.totalLines >= 1 },
  { id: 'lines_10', name: 'Разминка', desc: 'Очисти 10 линий', check: s => s.totalLines >= 10 },
  { id: 'lines_40', name: 'Спринтер', desc: 'Очисти 40 линий', check: s => s.totalLines >= 40 },
  { id: 'lines_100', name: 'Сотня', desc: 'Очисти 100 линий', check: s => s.totalLines >= 100 },
  { id: 'lines_200', name: 'Марафонец', desc: 'Очисти 200 линий', check: s => s.totalLines >= 200 },
  { id: 'score_1k', name: '1K', desc: 'Набери 1000 очков за игру', check: s => s.bestScore >= 1000 },
  { id: 'score_5k', name: '5K', desc: 'Набери 5000 очков за игру', check: s => s.bestScore >= 5000 },
  { id: 'score_20k', name: '20K', desc: 'Набери 20000 очков за игру', check: s => s.bestScore >= 20000 },
  { id: 'tetris', name: 'Тетрис!', desc: 'Очисти 4 линии сразу', check: s => s.tetrises >= 1 },
  { id: 'tetris5', name: 'Тетрис x5', desc: 'Сделай 5 тетрисов', check: s => s.tetrises >= 5 },
  { id: 'combo3', name: 'Комбо x3', desc: 'Сделай комбо x3', check: s => s.maxCombo >= 3 },
  { id: 'combo5', name: 'Комбо x5', desc: 'Сделай комбо x5', check: s => s.maxCombo >= 5 },
  { id: 'level5', name: 'Уровень 5', desc: 'Достигни 5 уровня в игре', check: s => s.maxLevel >= 5 },
  { id: 'level10', name: 'Уровень 10', desc: 'Достигни 10 уровня в игре', check: s => s.maxLevel >= 10 },
  { id: 'sprint_finish', name: 'Спринт пройден', desc: 'Пройди спринт 100L', check: s => s.sprints >= 1 },
  { id: 'buyer', name: 'Шопоголик', desc: 'Купи 3 темы', check: s => s.themesBought >= 3 },
  { id: 'case_open', name: 'Удача', desc: 'Открой кейс', check: s => s.casesOpened >= 1 },
  { id: 'tspin', name: 'T-Spin', desc: 'Сделай T-Spin', check: s => (s.tspins || 0) >= 1 },
  { id: 'profile_5', name: 'Профиль 5', desc: 'Профиль 5 уровня', check: s => profileLevel() >= 5 },
  { id: 'duel_win', name: 'Дуэлянт', desc: 'Выиграй дуэль', check: s => (s.duelWins || 0) >= 1 },
];

let stats = {
  totalLines: 0, bestScore: 0, tetrises: 0, maxCombo: 0,
  maxLevel: 1, sprints: 0, themesBought: 0, casesOpened: 0,
  tspins: 0, hungerLines: 0, gamesPlayed: 0, duelWins: 0, unlocked: {}
};

function profileLevel() {
  return Math.floor((stats.totalLines || 0) / 25) + 1;
}
function profileXP() {
  return (stats.totalLines || 0) % 25;
}
function updateProfileUI() {
  const lv = document.getElementById('profile-level');
  const xp = document.getElementById('profile-xp');
  const fill = document.getElementById('xp-fill');
  const level = profileLevel();
  const cur = profileXP();
  if (lv) lv.textContent = level;
  if (xp) xp.textContent = cur + '/25 XP';
  if (fill) fill.style.width = (cur / 25 * 100) + '%';
}

function saveStats() {
  saveUserData();
}

function checkAchievements() {
  let newOnes = [];
  ACHIEVEMENTS.forEach(a => {
    if (!stats.unlocked[a.id] && a.check(stats)) {
      stats.unlocked[a.id] = Date.now();
      newOnes.push(a);
    }
  });
  if (newOnes.length) {
    saveStats();
    newOnes.forEach(a => toast('🏆 ' + a.name));
  }
}

function renderAchievements() {
  const list = document.getElementById('achievements-list');
  if (!list) return;
  list.innerHTML = ACHIEVEMENTS.map(a => {
    const done = !!stats.unlocked[a.id];
    return `<div class="list-item ${done ? 'done' : ''}">
      <div class="li-icon">${done ? '✅' : '🔒'}</div>
      <div class="li-body"><div class="li-name">${a.name}</div><div class="li-desc">${a.desc}</div></div>
    </div>`;
  }).join('');
}

// ===================== DAILY QUESTS =====================
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}

const QUEST_POOL = [
  { id: 'q_lines5', name: 'Очисти 5 линий', target: 5, key: 'lines', reward: 150 },
  { id: 'q_lines10', name: 'Очисти 10 линий', target: 10, key: 'lines', reward: 300 },
  { id: 'q_lines20', name: 'Очисти 20 линий', target: 20, key: 'lines', reward: 450 },
  { id: 'q_lines40', name: 'Очисти 40 линий', target: 40, key: 'lines', reward: 800 },
  { id: 'q_score1k', name: 'Набери 1000 очков', target: 1000, key: 'score', reward: 250 },
  { id: 'q_score2k', name: 'Набери 2000 очков', target: 2000, key: 'score', reward: 400 },
  { id: 'q_score5k', name: 'Набери 5000 очков', target: 5000, key: 'score', reward: 700 },
  { id: 'q_tetris', name: 'Сделай 1 тетрис', target: 1, key: 'tetris', reward: 500 },
  { id: 'q_combo', name: 'Комбо x3', target: 3, key: 'combo', reward: 450 },
  { id: 'q_hold', name: 'Используй удержание 5 раз', target: 5, key: 'hold', reward: 350 },
];

let quests = {
  date: todayKey(),
  ver: 2,
  items: QUEST_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 10).map(q => ({ ...q, progress: 0, claimed: false }))
};

function questProgress(key, amount) {
  let changed = false;
  quests.items.forEach(q => {
    if (q.claimed) return;
    if (q.key === key) {
      q.progress = Math.min(q.target, q.progress + amount);
      changed = true;
      if (q.progress >= q.target && !q.claimed) {
        // auto-ready
      }
    }
  });
  if (changed) saveUserData();
}

function renderQuests() {
  const list = document.getElementById('quests-list');
  // date hidden
  if (!list) return;
  list.innerHTML = quests.items.map((q, i) => {
    const ready = q.progress >= q.target;
    const pct = Math.min(100, Math.floor(q.progress / q.target * 100));
    return `<div class="list-item ${q.claimed ? 'done' : ready ? 'ready' : ''}">
      <div class="li-body" style="flex:1">
        <div class="li-name">${q.name}</div>
        <div class="li-desc">${q.progress}/${q.target} · 💎 ${q.reward}</div>
        <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      </div>
      <button class="quest-claim" data-qi="${i}" ${(!ready || q.claimed) ? 'disabled' : ''}>${q.claimed ? '✓' : 'Забрать'}</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.quest-claim').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.qi;
      const q = quests.items[i];
      if (q.claimed || q.progress < q.target) return;
      q.claimed = true;
      balance += q.reward;
      updateBalance();
      saveUserData();
      toast('💎 +' + q.reward);
      renderQuests();
      sfx('coin');
    });
  });
}

// ===================== SFX (Web Audio) =====================
let audioCtx;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function sfx(type) {
  if (!settings.sound) return;
  ensureAudio();
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  if (type === 'move') {
    o.frequency.value = 180; g.gain.value = 0.03;
    o.type = 'square'; o.start(now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.05); o.stop(now + 0.05);
  } else if (type === 'rotate') {
    o.frequency.value = 320; g.gain.value = 0.04;
    o.type = 'square'; o.start(now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.06); o.stop(now + 0.06);
  } else if (type === 'drop') {
    o.frequency.value = 120; g.gain.value = 0.05;
    o.type = 'triangle'; o.start(now); o.frequency.exponentialRampToValueAtTime(60, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12); o.stop(now + 0.12);
  } else if (type === 'line') {
    o.frequency.value = 440; g.gain.value = 0.06;
    o.type = 'square'; o.start(now); o.frequency.exponentialRampToValueAtTime(880, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2); o.stop(now + 0.2);
  } else if (type === 'tetris') {
    o.frequency.value = 523; g.gain.value = 0.08;
    o.type = 'sawtooth'; o.start(now); o.frequency.exponentialRampToValueAtTime(1046, now + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3); o.stop(now + 0.3);
  } else if (type === 'hold') {
    o.frequency.value = 260; g.gain.value = 0.04;
    o.type = 'sine'; o.start(now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08); o.stop(now + 0.08);
  } else if (type === 'gameover') {
    o.frequency.value = 200; g.gain.value = 0.08;
    o.type = 'sawtooth'; o.start(now); o.frequency.exponentialRampToValueAtTime(50, now + 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55); o.stop(now + 0.55);
  } else if (type === 'coin') {
    o.frequency.value = 800; g.gain.value = 0.05;
    o.type = 'sine'; o.start(now); o.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15); o.stop(now + 0.15);
  } else if (type === 'level') {
    o.frequency.value = 400; g.gain.value = 0.05;
    o.type = 'square'; o.start(now); o.frequency.setValueAtTime(600, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2); o.stop(now + 0.2);
  }
}

function vibrate(ms) {
  if (!settings.vibrate) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch(e) {}
}

// ===================== TOAST =====================
function toast(msg, opts) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  if (opts && opts.sticky) {
    el._sticky = true;
    return el;
  }
  el._sticky = false;
  el._t = setTimeout(() => {
    if (!el._sticky) el.classList.remove('show');
  }, (opts && opts.ms) || 2200);
  return el;
}
function clearStickyToast() {
  const el = document.getElementById('toast');
  if (!el) return;
  el._sticky = false;
  clearTimeout(el._t);
  el.classList.remove('show');
}

// ===================== DOM =====================
const gameDiv = document.getElementById('game');
const shopDiv = document.getElementById('shop-screen');
const easterDiv = document.getElementById('easter-screen');
const modeScreen = document.getElementById('mode-screen');
const goScreen = document.getElementById('gameover-screen');
const searchInput = document.getElementById('search');
const shopItems = document.querySelectorAll('.shop-item');

if (searchInput) {
  searchInput.addEventListener('input', function() {
    const q = this.value.toLowerCase();
    shopItems.forEach(item => {
      item.style.display = item.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

const mellMusic = document.getElementById('mell-music');
const vids = {};
themes.slice(1).forEach(t => {
  const el = document.getElementById(`${t}-video`);
  if (el) {
    vids[t] = el;
    // lazy: don't load until bought/activated
    el.preload = 'none';
  }
});


// ===================== THEME OF THE DAY =====================
function themeOfDay() {
  const day = Math.floor(Date.now() / 86400000);
  const list = themes.filter(t => t !== 'theme');
  return list[day % list.length];
}
function setupThemeOfDay() {
  if (!document.getElementById('theme-of-day')) return;
  const tid = themeOfDay();
  const nameEl = document.getElementById('tod-name');
  if (nameEl) nameEl.textContent = tid;
  document.getElementById('tod-apply')?.addEventListener('click', () => {
    themes.forEach(x => active[x] = false);
    active[tid] = true;
    if (mellMusic) { mellMusic.pause(); mellMusic.currentTime = 0; }
    Object.values(vids).forEach(v => { try { v.pause(); v.currentTime = 0; } catch(e){} });
    const v = vids[tid];
    if (v) {
      if (v.preload === 'none') { v.preload = 'auto'; v.load(); }
      v.play().catch(() => {});
    }
    toast('Тема дня: ' + tid);
    sfx('coin');
  });
}

const mellBG = new Image();
mellBG.src = 'https://avatars.mds.yandex.net/i?id=f929b30edd21b71bed35148895c13bd3_l-4531164-images-thumbs&n=13';

function updateScore() {
  const sv = document.getElementById('score-val');
  const hv = document.getElementById('high-val');
  const lv = document.getElementById('level-val');
  const ln = document.getElementById('lines-val');
  const cv = document.getElementById('combo-val');
  const cc = document.getElementById('combo-card');
  if (sv) sv.textContent = score;
  const modeHi = getModeHigh(gameMode);
  if (hv) hv.textContent = modeHi;
  if (lv) lv.textContent = level;
  if (ln) ln.textContent = linesCleared;
  if (cv) cv.textContent = 'x' + combo;
  if (cc) cc.style.display = combo > 1 ? '' : 'none';
  if (score > modeHi) {
    setModeHigh(gameMode, score);
    if (hv) hv.textContent = score;
    saveUserData();
  }
  if (gameMode === 'duel') {
    publishDuelScore();
    if (score >= (settings.duelTarget || 5000) && !gameOver) {
      // finish for both via room status
      try {
        if (dbRef && duelId && currentUser) {
          const myId = fbKey(currentUser.uid);
          dbRef.ref('/duelRooms/' + duelId).update({
            status: 'finished',
            winner: myId,
            hostScore: null // filled in endGame
          });
        }
      } catch(e) {}
      endGame(true);
    }
  }
}

function updateBalance() {
  const bn = document.getElementById('balance-num');
  if (bn) bn.textContent = balance;
  localStorage.setItem('tetrisBalance', balance);
}

function saveBought() {
  saveUserData();
}

// ===================== SHOP BUY =====================
themes.forEach(function(t) {
  var buyBtn = document.getElementById('buy-' + t);
  var actionsDiv = document.getElementById(t + '-actions');
  if (!buyBtn || !actionsDiv) return;
  if (bought[t]) {
    buyBtn.style.display = 'none';
    actionsDiv.style.display = 'flex';
  }
  buyBtn.addEventListener('click', async function() {
    if (!bought[t] && balance >= 200) {
      balance -= 200;
      bought[t] = true;
      updateBalance();
      saveBought();
      stats.themesBought = Object.values(bought).filter(Boolean).length;
      saveStats();
      checkAchievements();
      buyBtn.disabled = true;
      buyBtn.textContent = 'Загрузка...';
      try {
        var videoElem = document.getElementById(t + '-video');
        if (t === 'theme' && mellMusic) {
          // already local
        } else if (videoElem && videoElem.preload === 'none') {
          videoElem.preload = 'auto';
          videoElem.load();
        }
        buyBtn.style.display = 'none';
        actionsDiv.style.display = 'flex';
        toast('Тема куплена!');
        sfx('coin');
      } catch (err) {
        buyBtn.style.display = 'none';
        actionsDiv.style.display = 'flex';
      }
    } else if (!bought[t]) {
      alert('Недостаточно очков');
    }
  });
});

themes.forEach(t => {
  const applyBtn = document.getElementById('apply-' + t);
  const removeBtn = document.getElementById('remove-' + t);
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      themes.forEach(x => active[x] = false);
      active[t] = true;
      if (mellMusic) { mellMusic.pause(); mellMusic.currentTime = 0; }
      Object.values(vids).forEach(v => { v.pause(); v.currentTime = 0; });
      if (t === 'theme' && mellMusic) mellMusic.play().catch(() => {});
      else if (vids[t]) {
        if (vids[t].preload === 'none') { vids[t].preload = 'auto'; vids[t].load(); }
        vids[t].play().catch(() => {});
      }
    });
  }
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      active[t] = false;
      if (t === 'theme' && mellMusic) { mellMusic.pause(); mellMusic.currentTime = 0; }
      else if (vids[t]) { vids[t].pause(); vids[t].currentTime = 0; }
    });
  }
});

// ===================== SCREENS =====================
function showScreen(el) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active-screen');
    s.style.display = 'none';
    s.style.opacity = '';
    s.style.pointerEvents = '';
  });
  if (!el) return;
  el.style.display = 'flex';
  el.style.opacity = '1';
  el.style.pointerEvents = 'auto';
  el.classList.add('active-screen');
}

document.getElementById('shop')?.addEventListener('click', () => {
  if (gameMode === 'duel' && !gameOver) {
    toast('В дуэли магазин недоступен');
    return;
  }
  showScreen(shopDiv);
  paused = true;
});
document.getElementById('return-shop')?.addEventListener('click', () => {
  showScreen(gameDiv);
  // keep pause state
});
document.getElementById('easter-egg')?.addEventListener('click', () => {
  if (gameMode === 'duel' && !gameOver) {
    toast('В дуэли пасхалка недоступна');
    return;
  }
  showScreen(easterDiv);
  paused = true;
});
document.getElementById('return')?.addEventListener('click', () => {
  showScreen(gameDiv);
  // keep pause state
});
document.getElementById('menu-btn')?.addEventListener('click', () => {
  if (gameMode === 'duel' && !gameOver) {
    toast('В дуэли нельзя выйти в меню');
    return;
  }
  paused = true;
  showScreen(modeScreen);
});

// Mode select (delegation — надёжнее)
function startModeFromCard(mode) {
  if (mode === 'duel') {
    openDuelLobby();
    return;
  }
  gameMode = mode || 'classic';
  ensureAudio();
  try {
    startGame();
  } catch (err) {
    console.error('startGame', err);
    toast('Ошибка старта: ' + err.message);
    return;
  }
  showScreen(gameDiv);
  paused = false;
  gameOver = false;
  lastTime = performance.now();
  dropCounter = 0;
}
document.querySelector('.mode-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-card');
  if (!btn) return;
  e.preventDefault();
  startModeFromCard(btn.getAttribute('data-mode') || 'classic');
});
document.querySelectorAll('.mode-card').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    startModeFromCard(btn.getAttribute('data-mode') || 'classic');
  });
});

document.getElementById('open-achievements')?.addEventListener('click', () => {
  renderAchievements();
  showScreen(document.getElementById('achievements-screen'));
});
document.getElementById('ach-back')?.addEventListener('click', () => showScreen(modeScreen));
document.getElementById('open-quests')?.addEventListener('click', () => {
  renderQuests();
  showScreen(document.getElementById('quests-screen'));
});
document.getElementById('quests-back')?.addEventListener('click', () => showScreen(modeScreen));

// Easter secret
const secretBtn = document.getElementById('secret-btn');
if (secretBtn) {
  const secretMenu = document.createElement('div');
  secretMenu.id = 'secret-menu';
  Object.assign(secretMenu.style, {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh',
    background: 'rgba(0,0,0,0.92)', display: 'none', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000
  });
  const secretImg = document.createElement('img');
  secretImg.src = 'secret.png';
  secretImg.style.maxWidth = '80%';
  secretImg.style.maxHeight = '80%';
  const closeSecret = document.createElement('button');
  closeSecret.textContent = 'Закрыть';
  closeSecret.className = 'primary-btn';
  closeSecret.style.marginTop = '20px';
  secretMenu.append(secretImg, closeSecret);
  document.body.appendChild(secretMenu);
  secretBtn.addEventListener('click', () => { secretMenu.style.display = 'flex'; });
  closeSecret.addEventListener('click', () => { secretMenu.style.display = 'none'; });
}



// ===================== SEASON PASS =====================
const SEASON_REWARDS = [
  { level: 1, reward: 100, label: '100 💎' },
  { level: 2, reward: 150, label: '150 💎' },
  { level: 3, reward: 200, label: '200 💎' },
  { level: 5, reward: 400, label: '400 💎' },
  { level: 7, reward: 500, label: '500 💎' },
  { level: 10, reward: 1000, label: '1000 💎 + титул' },
  { level: 15, reward: 1500, label: '1500 💎' },
  { level: 20, reward: 2500, label: '2500 💎 Легенда' },
];
// seasonClaimed global above

function renderSeason() {
  const list = document.getElementById('season-list');
  if (!list) return;
  const lvl = profileLevel();
  list.innerHTML = SEASON_REWARDS.map(r => {
    const claimed = !!seasonClaimed[r.level];
    const ready = lvl >= r.level && !claimed;
    return `<div class="list-item ${claimed ? 'done' : ready ? 'ready' : ''}">
      <div class="li-icon">${claimed ? '✅' : ready ? '🎁' : '🔒'}</div>
      <div class="li-body" style="flex:1">
        <div class="li-name">Уровень ${r.level}</div>
        <div class="li-desc">${r.label}${lvl >= r.level ? '' : ' · нужно ур. ' + r.level}</div>
      </div>
      <button class="quest-claim season-claim" data-lv="${r.level}" ${ready ? '' : 'disabled'}>
        ${claimed ? '✓' : ready ? 'Забрать' : 'Ур.' + r.level}
      </button>
    </div>`;
  }).join('');
  list.querySelectorAll('.season-claim').forEach(btn => {
    btn.onclick = () => {
      const lv = +btn.getAttribute('data-lv');
      const r = SEASON_REWARDS.find(x => x.level === lv);
      if (!r || seasonClaimed[lv] || profileLevel() < lv) return;
      seasonClaimed[lv] = true;
      saveUserData();
      balance += r.reward;
      updateBalance();
      toast('🎟️ Сезон: +' + r.reward + ' 💎');
      sfx('coin');
      renderSeason();
    };
  });
}

// season removed from UI
document.getElementById('season-back')?.addEventListener('click', () => showScreen(modeScreen));


// Settings UI
function bindSettings() {
  const map = [
    ['set-sound', 'sound', 'checked'],
    ['set-vibrate', 'vibrate', 'checked'],
    ['set-ghost', 'ghost', 'checked'],
    ['set-grid', 'grid', 'checked'],
    ['set-particles', 'particles', 'checked'],
    ['set-skin', 'skin', 'value'],
    ['set-das', 'das', 'value'],
    ['set-arr', 'arr', 'value'],
  ];
  map.forEach(([id, key, prop]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (prop === 'checked') el.checked = !!settings[key];
    else el.value = String(settings[key] ?? '');
    el.addEventListener('change', () => {
      if (prop === 'checked') settings[key] = el.checked;
      else if (key === 'das' || key === 'arr' || key === 'duelTarget') settings[key] = +el.value;
      else settings[key] = el.value;
      if (key === 'skin') colors = SKINS[settings.skin] || SKINS.classic;
      if (key === 'music' && !settings.music) {
        try { if (mellMusic) mellMusic.pause(); Object.values(vids).forEach(v => v.pause()); } catch(e) {}
      }
      saveSettings();
    });
  });
  colors = SKINS[settings.skin] || SKINS.classic;
}
document.getElementById('open-settings')?.addEventListener('click', () => {
  showScreen(document.getElementById('settings-screen'));
});
document.getElementById('settings-back')?.addEventListener('click', () => showScreen(modeScreen));
document.getElementById('open-leaderboard')?.addEventListener('click', () => {
  renderLeaderboard();
  showScreen(document.getElementById('leaderboard-screen'));
});
document.getElementById('lb-back')?.addEventListener('click', () => showScreen(modeScreen));

function getPlayerName() {
  let name = localStorage.getItem('tetrisName');
  if (!name) {
    name = 'Игрок' + Math.floor(Math.random() * 9000 + 1000);
    localStorage.setItem('tetrisName', name);
  }
  return name;
}

function getLocalScores() {
  try { return JSON.parse(localStorage.getItem('tetrisLocalScores') || '[]') || []; }
  catch(e) { return []; }
}

function saveLocalScore(entry) {
  let rows = getLocalScores();
  rows.push(entry);
  rows.sort((a, b) => (b.score || 0) - (a.score || 0));
  rows = rows.slice(0, 30);
  localStorage.setItem('tetrisLocalScores', JSON.stringify(rows));
  return rows;
}

function submitScore(sc) {
  if (!sc || sc <= 0) return;
  const entry = { name: getPlayerName(), score: sc, mode: gameMode, ts: Date.now() };
  saveLocalScore(entry);
  try {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      firebase.database().ref('/scores').push(entry);
    }
  } catch (e) { console.warn('submitScore firebase', e); }
}

function renderLeaderboardRows(rows, list, source) {
  if (!rows.length) {
    list.innerHTML = '<div class="list-item"><div class="li-desc">Пока пусто — сыграй партию!</div></div>';
    return;
  }
  list.innerHTML = rows.slice(0, 20).map((r, i) =>
    `<div class="list-item"><div class="li-icon">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div>
    <div class="li-body"><div class="li-name">${r.name||'?'}</div>
    <div class="li-desc">${r.score} · ${r.mode||''}</div></div></div>`
  ).join('') + `<div class="list-item"><div class="li-desc" style="text-align:center;width:100%">Источник: ${source}</div></div>`;
}

let lbTab = 'score';

function getLocalLevels() {
  try { return JSON.parse(localStorage.getItem('tetrisLocalLevels') || '[]') || []; }
  catch(e) { return []; }
}

function saveLocalLevel() {
  if (!currentUser) return;
  const name = settings.nickname || currentUser.login || getPlayerName();
  const level = profileLevel();
  let rows = getLocalLevels().filter(r => r.name !== name);
  rows.push({ name, level, lines: stats.totalLines || 0, ts: Date.now() });
  rows.sort((a,b) => (b.level||0) - (a.level||0) || (b.lines||0) - (a.lines||0));
  rows = rows.slice(0, 30);
  localStorage.setItem('tetrisLocalLevels', JSON.stringify(rows));
  if (dbRef) {
    try {
      dbRef.ref('/levels/' + encodeURIComponent(name)).set({ name, level, lines: stats.totalLines || 0, ts: Date.now() });
    } catch(e) {}
  }
}

function demoPlayers() {
  return [
    { name: 'ProGamer', score: 42000, level: 12, mode: 'classic' },
    { name: 'TetrisKing', score: 35500, level: 10, mode: 'sprint' },
    { name: 'LineClear', score: 28000, level: 9, mode: 'classic' },
    { name: 'ComboMaster', score: 21000, level: 8, mode: 'classic' },
    { name: 'PixelDrop', score: 15000, level: 6, mode: 'sprint' },
    { name: 'BlockNinja', score: 12000, level: 5, mode: 'classic' },
    { name: 'StackAttack', score: 9000, level: 4, mode: 'classic' },
    { name: 'SoftDrop', score: 6500, level: 3, mode: 'sprint' },
  ];
}

function renderLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;
  list.innerHTML = '<div class="list-item"><div class="li-desc">Загрузка...</div></div>';
  saveLocalLevel();

  if (lbTab === 'level') {
    const local = getLocalLevels();
    const demo = demoPlayers().map(d => ({ name: d.name, level: d.level, lines: d.level * 25 }));
    let rows = local.concat(demo);
    const loadCloud = dbRef
      ? dbRef.ref('/levels').limitToLast(40).once('value').then(snap => {
          snap.forEach(c => { const v = c.val(); if (v && v.name) rows.push(v); });
        }).catch(() => {})
      : Promise.resolve();
    loadCloud.finally(() => {
      const seen = new Set();
      const uniq = [];
      rows.sort((a,b) => (b.level||0) - (a.level||0) || (b.lines||0) - (a.lines||0));
      for (const r of rows) {
        const k = String(r.name||'').toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(r);
        if (uniq.length >= 20) break;
      }
      list.innerHTML = uniq.map((r,i) =>
        `<div class="list-item"><div class="li-icon">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</div>
        <div class="li-body"><div class="li-name">${r.name||'?'}</div>
        <div class="li-desc">Ур. ${r.level||1} · ${r.lines||0} линий</div></div></div>`
      ).join('') || '<div class="list-item"><div class="li-desc">Пусто</div></div>';
    });
    return;
  }

  // score tab
  const local = getLocalScores();
  const demo = demoPlayers().map(d => ({ name: d.name, score: d.score, mode: d.mode }));
  let rows = local.concat(demo);
  const loadCloud = (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length)
    ? firebase.database().ref('/scores').limitToLast(50).once('value').then(snap => {
        snap.forEach(c => { const v = c.val(); if (v && typeof v.score === 'number') rows.push(v); });
      }).catch(() => {})
    : Promise.resolve();
  loadCloud.finally(() => {
    const seen = new Set();
    const uniq = [];
    rows.sort((a,b) => (b.score||0) - (a.score||0));
    for (const r of rows) {
      const k = (r.name||'') + '|' + r.score;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(r);
      if (uniq.length >= 20) break;
    }
    renderLeaderboardRows(uniq, list, 'игроки');
  });
}

document.querySelectorAll('.lb-tabs .auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    lbTab = tab.getAttribute('data-lb') || 'score';
    document.querySelectorAll('.lb-tabs .auth-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderLeaderboard();
  });
});


// ===================== CASE =====================
const caseBtn = document.getElementById('case-btn');
const caseScreen = document.getElementById('case-screen');
const returnCaseBtn = document.getElementById('return-case');
const timerEl = document.getElementById('timer');
const openCaseBtn = document.getElementById('open-case');
let caseAvailableAt = 0;
const rewards = [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];

caseBtn?.addEventListener('click', () => {
  if (gameMode === 'duel' && !gameOver) {
    toast('В дуэли кейс недоступен');
    return;
  }
  updateCaseTimer();
  showScreen(caseScreen);
  paused = true;
});
returnCaseBtn?.addEventListener('click', () => {
  showScreen(gameDiv);
  // keep pause state
});

function updateCaseTimer() {
  const diff = caseAvailableAt - Date.now();
  if (diff <= 0) {
    if (timerEl) timerEl.textContent = '00:00';
    if (openCaseBtn) openCaseBtn.disabled = false;
  } else {
    const sec = Math.floor(diff / 1000) % 60;
    const min = Math.floor(diff / 60000);
    if (timerEl) timerEl.textContent = `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    if (openCaseBtn) openCaseBtn.disabled = true;
    setTimeout(updateCaseTimer, 1000);
  }
}

openCaseBtn?.addEventListener('click', () => {
  const scroll = document.getElementById('case-scroll');
  if (!scroll) return;
  scroll.innerHTML = '';
  scroll.style.transition = 'none';
  scroll.style.transform = 'translateX(0)';

  // 10% chance theme reward slot
  const freeThemes = themes.filter(t => t !== 'theme' && !bought[t]);
  const giveTheme = freeThemes.length && Math.random() < 0.12;

  setTimeout(() => {
    const pool = [];
    for (let i = 0; i < 50; i++) {
      const div = document.createElement('div');
      div.className = 'case-item';
      if (giveTheme && i === 25) {
        div.textContent = '🎨 Тема!';
        div.dataset.theme = freeThemes[Math.floor(Math.random() * freeThemes.length)];
        pool.push('theme:' + div.dataset.theme);
      } else {
        const value = rewards[Math.floor(Math.random() * rewards.length)];
        div.textContent = value + ' очков';
        pool.push(value);
      }
      scroll.appendChild(div);
    }
    const stopIndex = giveTheme ? 25 : (20 + Math.floor(Math.random() * 10));
    const scrollWrapper = document.getElementById('case-scroll-wrapper');
    const itemWidth = 110;
    const wrapperWidth = scrollWrapper ? scrollWrapper.offsetWidth : 300;
    const centerOffset = (stopIndex * itemWidth) - (wrapperWidth / 2) + (itemWidth / 2);
    scroll.style.transition = 'transform 5s cubic-bezier(0.15, 0.85, 0.35, 1)';
    scroll.style.transform = `translateX(${-centerOffset}px)`;
    openCaseBtn.disabled = true;

    const reward = pool[stopIndex];
    const handleTransitionEnd = () => {
      scroll.removeEventListener('transitionend', handleTransitionEnd);
      if (typeof reward === 'string' && reward.startsWith('theme:')) {
        const tid = reward.slice(6);
        bought[tid] = true;
        saveBought();
        stats.themesBought = Object.values(bought).filter(Boolean).length;
        const buyBtn = document.getElementById('buy-' + tid);
        const actionsDiv = document.getElementById(tid + '-actions');
        if (buyBtn) buyBtn.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'flex';
        toast('🎨 Выпала тема: ' + tid);
        sfx('coin');
      } else {
        score += reward;
        balance += reward;
        updateScore();
        updateBalance();
        toast('+' + reward + ' очков!');
        sfx('coin');
      }
      stats.casesOpened = (stats.casesOpened || 0) + 1;
      saveStats();
      checkAchievements();
      caseAvailableAt = Date.now() + 60 * 60 * 1000;
      saveUserData();
      updateCaseTimer();
    };
    scroll.addEventListener('transitionend', handleTransitionEnd);
  }, 50);
});

// ===================== GAME LOGIC =====================
function createMatrix(w, h) {
  const m = [];
  while (h--) m.push(new Array(w).fill(0));
  return m;
}

const arena = createMatrix(12, 20);
const player = { pos: { x: 0, y: 0 }, matrix: null, next: null };

// colors from SKINS

function collide(arena, p) {
  const [m, o] = [p.matrix, p.pos];
  return m.some((row, y) =>
    row.some((val, x) => {
      if (!val) return false;
      const dy = y + o.y, dx = x + o.x;
      return dy < 0 || dy >= arena.length || dx < 0 || dx >= arena[0].length || arena[dy][dx] !== 0;
    })
  );
}

function createPiece(type) {
  switch (type) {
    case 'T': return [[0,0,0],[1,1,1],[0,1,0]];
    case 'O': return [[2,2],[2,2]];
    case 'L': return [[0,3,0],[0,3,0],[0,3,3]];
    case 'J': return [[0,4,0],[0,4,0],[4,4,0]];
    case 'I': return [[0,5,0,0],[0,5,0,0],[0,5,0,0],[0,5,0,0]];
    case 'S': return [[0,6,6],[6,6,0],[0,0,0]];
    case 'Z': return [[7,7,0],[0,7,7],[0,0,0]];
  }
}

function rotate(matrix, dir) {
  for (let y = 0; y < matrix.length; ++y)
    for (let x = 0; x < y; ++x)
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
  if (dir > 0) matrix.forEach(r => r.reverse());
  else matrix.reverse();
}

function drawMatrix(matrix, offset, alpha = 1) {
  matrix.forEach((row, y) =>
    row.forEach((val, x) => {
      if (val) {
        const dy = y + offset.y, dx = x + offset.x;
        if (dy >= 0 && dy < arena.length && dx >= 0 && dx < arena[0].length) {
          ctx.globalAlpha = alpha;
          const c = colors[val] || colors[7] || '#888';
          ctx.fillStyle = c;
          ctx.fillRect(dx, dy, 1, 1);
          if (settings.skin === 'neon') {
            ctx.strokeStyle = c;
            ctx.lineWidth = 0.08;
            ctx.globalAlpha = alpha * 0.5;
            ctx.strokeRect(dx - 0.05, dy - 0.05, 1.1, 1.1);
            ctx.globalAlpha = alpha;
          } else if (settings.skin === 'glass') {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(dx, dy, 1, 0.35);
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 0.05;
          ctx.strokeRect(dx, dy, 1, 1);
          ctx.globalAlpha = 1;
        }
      }
    })
  );
}

function getGhostY() {
  if (!player.matrix) return 0;
  const ghost = { pos: { x: player.pos.x, y: player.pos.y }, matrix: player.matrix };
  let guard = 0;
  while (!collide(arena, ghost) && guard++ < 30) ghost.pos.y++;
  ghost.pos.y--;
  return ghost.pos.y;
}

function drawMini(targetCtx, targetCanvas, matrix) {
  if (!targetCtx || !matrix) {
    if (targetCtx && targetCanvas) {
      targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetCtx.fillStyle = '#0a0a14';
      targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    }
    return;
  }
  targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetCtx.fillStyle = '#0a0a14';
  targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  const cell = 14;
  const mw = matrix[0].length * cell;
  const mh = matrix.length * cell;
  const ox = (targetCanvas.width - mw) / 2;
  const oy = (targetCanvas.height - mh) / 2;
  matrix.forEach((row, y) => row.forEach((val, x) => {
    if (val) {
      targetCtx.fillStyle = colors[val];
      targetCtx.fillRect(ox + x * cell, oy + y * cell, cell - 1, cell - 1);
    }
  }));
}

function drawNextPiece() { drawMini(nextCtx, nextCanvas, player.next); }
function drawHoldPiece() { drawMini(holdCtx, holdCanvas, holdMatrix); }

function spawnParticles(rowY, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * 12,
      y: rowY + Math.random(),
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.25 - 0.05,
      life: 1,
      color: colors[1 + (Math.random() * 7 | 0)]
    });
  }
}

function updateParticles(dt) {
  particles = particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.01;
    p.life -= dt / 500;
    return p.life > 0;
  });
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 0.25, 0.25);
  });
  ctx.globalAlpha = 1;
}

function draw() {
  // Always reset transform to block scale (fixes invisible pieces)
  ctx.setTransform(20, 0, 0, 20, 0, 0);

  // shake
  const boardWrap = document.getElementById('board-wrap');
  if (settings.shake && shakeTime > 0 && boardWrap) {
    const s = Math.min(shakeTime, 200) / 100;
    boardWrap.style.transform = `translate(${(Math.random()-0.5)*s*4}px, ${(Math.random()-0.5)*s*4}px)`;
  } else if (boardWrap) {
    boardWrap.style.transform = '';
  }

  // Background in pixel space
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let bgDrawn = false;
  try {
    if (active.theme && mellBG.complete && mellBG.naturalWidth) {
      ctx.drawImage(mellBG, 0, 0, canvas.width, canvas.height);
      bgDrawn = true;
    } else {
      for (const t of themes.slice(1)) {
        if (active[t] && vids[t] && vids[t].readyState >= 2) {
          ctx.drawImage(vids[t], 0, 0, canvas.width, canvas.height);
          bgDrawn = true;
          break;
        }
      }
    }
  } catch (e) { /* ignore media draw errors */ }
  if (!bgDrawn) {
    ctx.fillStyle = '#0c0c18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Back to block coordinates
  ctx.setTransform(20, 0, 0, 20, 0, 0);

  // grid
  if (settings.grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.03;
    for (let x = 0; x <= 12; x++) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 20); ctx.stroke(); }
    for (let y = 0; y <= 20; y++) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(12, y); ctx.stroke(); }
  }

  drawMatrix(arena, { x: 0, y: 0 });
  // line clear flash
  if (lineFlashTime > 0 && lineFlashRows.length) {
    ctx.globalAlpha = Math.min(1, lineFlashTime / 180) * 0.7;
    ctx.fillStyle = '#ffffff';
    lineFlashRows.forEach(y => ctx.fillRect(0, y, 12, 1));
    ctx.globalAlpha = 1;
  }
  if (settings.ghost && player.matrix && !gameOver) {
    const gy = getGhostY();
    if (gy >= 0) drawMatrix(player.matrix, { x: player.pos.x, y: gy }, 0.25);
  }
  if (player.matrix) drawMatrix(player.matrix, player.pos);
  if (settings.particles) drawParticles();
  drawNextPiece();
  drawHoldPiece();

  if (paused && !gameOver) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ПАУЗА', canvas.width / 2, canvas.height / 2);
    ctx.setTransform(20, 0, 0, 20, 0, 0);
  }
}

function arenaSweep() {
  let rowCount = 0;
  const clearedYs = [];
  outer: for (let y = arena.length - 1; y >= 0; --y) {
    for (let x = 0; x < arena[y].length; ++x) {
      if (arena[y][x] === 0) continue outer;
    }
    clearedYs.push(y);
    const row = arena.splice(y, 1)[0].fill(0);
    arena.unshift(row);
    rowCount++;
    y++;
  }

  if (rowCount > 0) {
    combo++;
    if (combo > stats.maxCombo) { stats.maxCombo = combo; saveStats(); }
    const pointsTable = [0, 100, 300, 500, 800];
    let gained = (pointsTable[rowCount] || 800) * level;
    if (combo > 1) gained += 50 * combo * level;
    // T-Spin bonus (checked before piece merges... we check on last rotate flag stored)
    if (window._pendingTSpin) {
      gained += 400 * level * rowCount;
      stats.tspins = (stats.tspins || 0) + 1;
      toast('T-SPIN! +' + (400 * level * rowCount));
      window._pendingTSpin = false;
      sfx('tetris');
    }
    score += gained;
    balance += gained;
    linesCleared += rowCount;
    stats.totalLines += rowCount;
    if (gameMode === 'hunger') stats.hungerLines = (stats.hungerLines || 0) + rowCount;
    questProgress('lines', rowCount);
    questProgress('score', gained);
    if (combo >= 3) questProgress('combo', combo);
    updateProfileUI();

    if (settings.particles) clearedYs.forEach(y => spawnParticles(y, 18));
    lineFlashRows = clearedYs.slice();
    lineFlashTime = 180;
    if (rowCount >= 4) {
      stats.tetrises = (stats.tetrises || 0) + 1;
      questProgress('tetris', 1);
      shakeTime = 250;
      sfx('tetris');
      vibrate(40);
      toast('TETRIS! +' + gained);
    } else {
      sfx('line');
      vibrate(15);
    }

    if (gameMode !== 'zen') {
      const newLevel = Math.floor(linesCleared / 10) + 1;
      if (newLevel > level) {
        level = newLevel;
        dropInterval = Math.max(80, 1000 - (level - 1) * 70);
        if (level > stats.maxLevel) { stats.maxLevel = level; saveStats(); }
        sfx('level');
        toast('Уровень ' + level);
      }
    }

    if (gameMode === 'sprint' && linesCleared >= sprintTarget) {
      finishSprint();
    }

    saveStats();
    checkAchievements();
    updateScore();
    updateBalance();
  } else {
    combo = 0;
    updateScore();
  }
}

function merge(arena, player) {
  player.matrix.forEach((row, y) =>
    row.forEach((val, x) => {
      if (val) arena[y + player.pos.y][x + player.pos.x] = val;
    })
  );
}

function randomPiece() {
  const pieces = 'TJLOSZI';
  return createPiece(pieces[(Math.random() * pieces.length) | 0]);
}

function playerReset() {
  player.matrix = player.next || randomPiece();
  player.next = randomPiece();
  player.pos.y = 0;
  player.pos.x = ((arena[0].length / 2) | 0) - ((player.matrix[0].length / 2) | 0);
  holdLocked = false;
  if (collide(arena, player)) {
    endGame(false);
  }
}

function playerDrop() {
  if (paused || gameOver) return;
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    window._pendingTSpin = checkTSpin();
    merge(arena, player);
    arenaSweep();
    playerReset();
    sfx('drop');
  } else if (softDropping) {
    score += 1;
    updateScore();
  }
  dropCounter = 0;
}

function playerHardDrop() {
  if (paused || gameOver) return;
  let dist = 0;
  while (!collide(arena, player)) { player.pos.y++; dist++; }
  player.pos.y--;
  dist--;
  window._pendingTSpin = checkTSpin();
  merge(arena, player);
  arenaSweep();
  playerReset();
  dropCounter = 0;
  score += Math.max(0, dist) * 2;
  updateScore();
  sfx('drop');
  vibrate(10);
}

function playerMove(dir) {
  if (paused || gameOver) return;
  player.pos.x += dir;
  if (collide(arena, player)) player.pos.x -= dir;
  else sfx('move');
}

function playerRotate(dir) {
  if (paused || gameOver || !player.matrix) return;
  const pos = player.pos.x;
  const py = player.pos.y;
  rotate(player.matrix, dir);
  const kicks = [0, 1, -1, 2, -2];
  let ok = false;
  let usedKick = false;
  for (const k of kicks) {
    player.pos.x = pos + k;
    if (!collide(arena, player)) {
      ok = true;
      usedKick = k !== 0;
      break;
    }
  }
  if (!ok) {
    // try small vertical kicks
    for (const ky of [-1, 1]) {
      for (const k of [0, 1, -1]) {
        player.pos.x = pos + k;
        player.pos.y = py + ky;
        if (!collide(arena, player)) {
          ok = true; usedKick = true; break;
        }
      }
      if (ok) break;
    }
  }
  if (!ok) {
    rotate(player.matrix, -dir);
    player.pos.x = pos;
    player.pos.y = py;
    return;
  }
  lastRotateWasKick = usedKick;
  sfx('rotate');
}

function isTPiece(m) {
  if (!m || m.length < 2) return false;
  // T shape has 4 cells in T configuration
  let cells = 0;
  m.forEach(r => r.forEach(v => { if (v === 1) cells++; }));
  return cells === 4 || (m.some(r => r.includes(1)) && cells >= 3);
}

function checkTSpin() {
  if (!player.matrix) return false;
  // crude T-spin: last move was rotate and 3+ corners blocked around center
  let hasT = false;
  player.matrix.forEach(r => r.forEach(v => { if (v === 1) hasT = true; }));
  if (!hasT) return false;
  const cx = player.pos.x + 1, cy = player.pos.y + 1;
  const corners = [[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]];
  let blocked = 0;
  corners.forEach(([x,y]) => {
    if (y < 0 || y >= arena.length || x < 0 || x >= arena[0].length || arena[y][x] !== 0) blocked++;
  });
  return blocked >= 3 && lastRotateWasKick;
}

function addGarbage(n) {
  for (let i = 0; i < n; i++) {
    const hole = (Math.random() * 12) | 0;
    const row = new Array(12).fill(8); // color 8 will map - need color
    // use color index 7 as garbage look
    for (let x = 0; x < 12; x++) row[x] = x === hole ? 0 : 7;
    arena.shift();
    arena.push(row);
  }
  // if player collides after garbage, push up or end
  if (player.matrix && collide(arena, player)) {
    player.pos.y--;
    if (collide(arena, player)) {
      if (gameMode === 'duel' && dbRef && duelId && currentUser) {
        try {
          const myId = fbKey(currentUser.uid);
          dbRef.ref('/duelRooms/' + duelId).once('value').then(s => {
            const v = s.val() || {};
            const isHost = String(v.host) === myId;
            dbRef.ref('/duelRooms/' + duelId).update({
              status: 'finished',
              winner: isHost ? v.guest : v.host,
              hostScore: isHost ? score : (v.hostScore || 0),
              guestScore: isHost ? (v.guestScore || 0) : score,
              ts: Date.now()
            });
          });
        } catch(e) {}
      }
      endGame(false);
    }
  }
}

function playerHold() {
  try { questProgress('hold', 1); } catch(e) {}
  if (paused || gameOver || holdLocked) return;
  const current = player.matrix;
  if (holdMatrix) {
    player.matrix = holdMatrix;
    holdMatrix = current;
  } else {
    holdMatrix = current;
    player.matrix = player.next;
    player.next = randomPiece();
  }
  player.pos.y = 0;
  player.pos.x = ((arena[0].length / 2) | 0) - ((player.matrix[0].length / 2) | 0);
  if (collide(arena, player)) {
    // undo is hard — just end if impossible
    endGame(false);
    return;
  }
  holdLocked = true;
  drawHoldPiece();
  sfx('hold');
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m + ':' + String(ss).padStart(2, '0');
}


// ===================== DUEL =====================
function stopDuel() {
  if (duelUnsub) { try { duelUnsub(); } catch(e) {} duelUnsub = null; }
  if (duelId) {
    try {
      if (typeof firebase !== 'undefined') {
        firebase.database().ref('/duels/' + duelId).off();
        // leave room after short delay so opponent sees final score
      }
    } catch(e) {}
  }
  duelId = null;
  duelOppScore = 0;
  const dc = document.getElementById('duel-card');
  if (dc) dc.style.display = 'none';
}

function startDuelMatchmaking() {
  if (typeof firebase === 'undefined') {
    toast('Дуэль недоступна офлайн');
    gameMode = 'classic';
    return false;
  }
  try {
    const db = firebase.database();
    const waiting = db.ref('/duelWaiting');
    // try join existing
    // Simplified: create unique duel id from two random players via push
    const myId = localStorage.getItem('tetrisDuelId') || Math.random().toString(36).slice(2);
    localStorage.setItem('tetrisDuelId', myId);
    const name = localStorage.getItem('tetrisName') || ('Игрок' + Math.floor(Math.random()*9000+1000));
    localStorage.setItem('tetrisName', name);

    // Look for open room
    waiting.once('value', snap => {
      let joined = false;
      snap.forEach(child => {
        if (joined) return;
        const v = child.val();
        if (v && v.status === 'waiting' && v.host !== myId) {
          joined = true;
          duelId = child.key;
          child.ref.update({ status: 'active', guest: myId, guestName: name, guestScore: 0 });
          toast('⚔️ Соперник найден!');
          listenDuel();
        }
      });
      if (!joined) {
        const ref = waiting.push({
          host: myId, hostName: name, hostScore: 0, guestScore: 0,
          status: 'waiting', ts: Date.now()
        });
        duelId = ref.key;
        toast('⚔️ Поиск соперника...');
        // wait for guest
        ref.on('value', s => {
          const v = s.val();
          if (!v) return;
          if (v.status === 'active') {
            toast('⚔️ Соперник подключился!');
            listenDuel();
          }
        });
        // timeout 20s -> solo practice vs ghost target
        setTimeout(() => {
          if (gameMode === 'duel' && duelOppScore === 0) {
            toast('Играем против цели 5000');
          }
        }, 20000);
      }
    });
    return true;
  } catch(e) {
    toast('Дуэль: ошибка сети');
    return false;
  }
}

function listenDuel() {
  if (!duelId || typeof firebase === 'undefined') return;
  const ref = firebase.database().ref('/duelWaiting/' + duelId);
  const handler = s => {
    const v = s.val();
    if (!v) return;
    const myId = localStorage.getItem('tetrisDuelId');
    if (v.host === myId) {
      duelOppScore = v.guestScore || 0;
    } else {
      duelOppScore = v.hostScore || 0;
    }
    const el = document.getElementById('duel-opp');
    if (el) el.textContent = duelOppScore;
    // win/lose check
    if (duelOppScore >= (settings.duelTarget || 5000) && score < (settings.duelTarget || 5000) && !gameOver) {
      endGame(false);
      toast('Поражение в дуэли');
    }
  };
  ref.on('value', handler);
  duelUnsub = () => ref.off('value', handler);
}

function publishDuelScore() {
  if (gameMode !== 'duel' || !duelId || !dbRef || !currentUser) return;
  try {
    const myId = fbKey(currentUser.uid);
    const ref = dbRef.ref('/duelRooms/' + duelId);
    ref.once('value').then(s => {
      const v = s.val();
      if (!v) return;
      if (String(v.host) === myId) ref.update({ hostScore: score, ts: Date.now() });
      else if (String(v.guest) === myId) ref.update({ guestScore: score, ts: Date.now() });
    });
  } catch(e) { console.warn('publishDuel', e); }
}

function startGame() {
  arena.forEach(r => r.fill(0));
  score = 0; level = 1; linesCleared = 0; combo = 0;
  dropInterval = gameMode === 'zen' ? 1200 : 1000;
  gameOver = false; paused = false;
  holdMatrix = null; holdLocked = false;
  particles = []; shakeTime = 0;
  hungerTimer = 0; hungerInterval = 12000;
  lastRotateWasKick = false;
  lineFlashRows = []; lineFlashTime = 0;
  // do not clear active duel room mid-start
  if (!(gameMode === 'duel' && duelId)) stopDuel();
  player.next = randomPiece();
  player.matrix = null;
  playerReset();
  if (!player.matrix) {
    player.matrix = randomPiece();
    player.pos = { x: 4, y: 0 };
  }
  updateScore();
  const tc = document.getElementById('timer-card');
  const dc = document.getElementById('duel-card');
  if (gameMode === 'sprint') {
    sprintStart = performance.now();
    sprintElapsed = 0;
    if (tc) tc.style.display = '';
  } else {
    if (tc) tc.style.display = 'none';
  }
  if (gameMode === 'duel') {
    if (dc) dc.style.display = '';
    const el = document.getElementById('duel-opp');
    if (el) el.textContent = String(duelOppScore || 0);
    const dt = document.getElementById('duel-target-val');
    if (dt) dt.textContent = String(settings.duelTarget || 5000);
  } else {
    if (dc) dc.style.display = 'none';
  }
  questProgress('games', 1);
  stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
  saveStats();
  checkAchievements();
}

function endGame(won) {
  gameOver = true;
  paused = true;
  if (window._botTimer) { clearInterval(window._botTimer); window._botTimer = null; }
  publishDuelScore();
  sfx(won ? 'tetris' : 'gameover');
  if (score > stats.bestScore) { stats.bestScore = score; saveStats(); }
  checkAchievements();

  const titleEl = document.getElementById('go-title');
  const subEl = document.getElementById('go-subtitle');
  const duelRow = document.getElementById('go-duel-row');
  const retryBtn = document.getElementById('go-retry');
  const tr = document.getElementById('go-time-row');

  if (gameMode === 'duel') {
    const target = settings.duelTarget || 5000;
    let youWon = false;
    if (score >= target) youWon = true;
    else if (duelOppScore >= target) youWon = false;
    else youWon = !!won; // top-out: caller passes false for loser

    if (youWon) {
      stats.duelWins = (stats.duelWins || 0) + 1;
      saveStats();
      checkAchievements();
      if (titleEl) titleEl.textContent = 'ПОБЕДА';
      if (subEl) {
        subEl.style.display = '';
        subEl.textContent = 'Ты победил · соперник проиграл';
      }
    } else {
      if (titleEl) titleEl.textContent = 'ПОРАЖЕНИЕ';
      if (subEl) {
        subEl.style.display = '';
        subEl.textContent = 'Ты проиграл · соперник победил';
      }
    }
    if (duelRow) {
      duelRow.style.display = '';
      const oppEl = document.getElementById('go-duel-opp');
      if (oppEl) oppEl.textContent = String(duelOppScore || 0);
    }
    if (retryBtn) retryBtn.style.display = 'none';
    if (tr) tr.style.display = 'none';
    try {
      if (dbRef && duelId && currentUser) {
        const myId = fbKey(currentUser.uid);
        const ref = dbRef.ref('/duelRooms/' + duelId);
        ref.once('value').then(s => {
          const v = s.val() || {};
          if (v.status === 'finished') return;
          const isHost = String(v.host) === myId;
          ref.update({
            status: 'finished',
            winner: youWon ? myId : (isHost ? v.guest : v.host),
            hostScore: isHost ? score : (v.hostScore || duelOppScore),
            guestScore: isHost ? (v.guestScore || duelOppScore) : score,
            ts: Date.now()
          });
        });
      }
    } catch (e) {}
  } else {
    if (subEl) { subEl.style.display = 'none'; subEl.textContent = ''; }
    if (duelRow) duelRow.style.display = 'none';
    if (retryBtn) retryBtn.style.display = '';
    if (won) {
      if (titleEl) titleEl.textContent = gameMode === 'sprint' ? 'СПРИНТ ПРОЙДЕН!' : 'ПОБЕДА!';
    } else {
      if (titleEl) titleEl.textContent = 'GAME OVER';
    }
    if (gameMode === 'sprint' && tr) {
      tr.style.display = '';
      const gt = document.getElementById('go-time');
      if (gt) gt.textContent = formatTime(sprintElapsed);
    } else if (tr) tr.style.display = 'none';
  }

  document.getElementById('go-score').textContent = score;
  const gl = document.getElementById('go-lines');
  const glev = document.getElementById('go-level');
  if (gl) gl.textContent = linesCleared;
  if (glev) glev.textContent = level;
  const linesRow = document.getElementById('go-lines-row');
  const levelRow = document.getElementById('go-level-row');
  if (gameMode === 'duel') {
    if (linesRow) linesRow.style.display = 'none';
    if (levelRow) levelRow.style.display = 'none';
  } else {
    if (linesRow) linesRow.style.display = '';
    if (levelRow) levelRow.style.display = '';
  }
  submitScore(score);
  showScreen(goScreen);
}

function finishSprint() {
  sprintElapsed = performance.now() - sprintStart;
  stats.sprints = (stats.sprints || 0) + 1;
  saveStats();
  checkAchievements();
  endGame(true);
  toast('Спринт: ' + formatTime(sprintElapsed));
}

document.getElementById('go-retry')?.addEventListener('click', () => {
  startGame();
  showScreen(gameDiv);
});
document.getElementById('go-menu')?.addEventListener('click', () => {
  showScreen(modeScreen);
});
document.getElementById('go-share')?.addEventListener('click', async () => {
  const text = `Tetris · ${score} очков · ${linesCleared} линий · ур.${level}` +
    (gameMode === 'sprint' ? ` · ${formatTime(sprintElapsed)}` : '');
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Скопировано!');
    }
  } catch(e) {
    try { await navigator.clipboard.writeText(text); toast('Скопировано!'); } catch(e2) {}
  }
});

// ===================== LOOP =====================
function update(time = 0) {
  const delta = time - lastTime;
  lastTime = time;

  if (!paused && !gameOver && player.matrix) {
    dropCounter += delta;
    if (dropCounter > dropInterval) playerDrop();
    if (gameMode === 'sprint' && sprintStart) {
      sprintElapsed = performance.now() - sprintStart;
      const tv = document.getElementById('timer-val');
      if (tv) tv.textContent = formatTime(sprintElapsed);
    }
    if (gameMode === 'hunger') {
      hungerTimer += delta;
      if (hungerTimer >= hungerInterval) {
        hungerTimer = 0;
        addGarbage(1);
        // speed up garbage over time
        hungerInterval = Math.max(4000, hungerInterval - 200);
        sfx('drop');
      }
    }
  }
  if (shakeTime > 0) shakeTime -= delta;
  if (lineFlashTime > 0) lineFlashTime -= delta;
  updateParticles(delta);
  draw();
  requestAnimationFrame(update);
}

// ===================== CONTROLS =====================
['left','right','down','rotate'].forEach(id => {
  const btn = document.getElementById(id);
  if (!btn) return;
  let iv, delayT;
  const action = () => {
    if (id === 'left') playerMove(-1);
    if (id === 'right') playerMove(1);
    if (id === 'down') { softDropping = true; playerDrop(); }
    if (id === 'rotate') playerRotate(1);
  };
  const startRepeat = () => {
    action();
    clearTimeout(delayT); clearInterval(iv);
    delayT = setTimeout(() => {
      iv = setInterval(action, settings.arr || 70);
    }, settings.das || 250);
  };
  const stopRepeat = () => {
    clearTimeout(delayT); clearInterval(iv); softDropping = false;
  };
  btn.addEventListener('mousedown', startRepeat);
  btn.addEventListener('mouseup', stopRepeat);
  btn.addEventListener('mouseleave', stopRepeat);
  btn.addEventListener('touchstart', e => { e.preventDefault(); startRepeat(); }, { passive: false });
  btn.addEventListener('touchend', e => { e.preventDefault(); stopRepeat(); }, { passive: false });
});

document.getElementById('hard-drop')?.addEventListener('click', () => playerHardDrop());
document.getElementById('hold-btn')?.addEventListener('click', () => playerHold());
document.getElementById('pause-btn')?.addEventListener('click', () => {
  if (gameMode === 'duel') {
    toast('В дуэли пауза недоступна');
    return;
  }
  if (!gameOver && gameDiv.style.display !== 'none') paused = !paused;
});

document.addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight','ArrowDown','ArrowUp',' '].includes(e.key)) e.preventDefault();
  if (e.key === 'ArrowLeft') playerMove(-1);
  if (e.key === 'ArrowRight') playerMove(1);
  if (e.key === 'ArrowDown') { softDropping = true; playerDrop(); }
  if (e.key === 'ArrowUp') playerRotate(1);
  if (e.key === ' ' || e.code === 'Space') playerHardDrop();
  if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') playerHold();
  if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
    if (!gameOver && gameDiv.classList.contains('active-screen') || gameDiv.style.display === 'flex')
      paused = !paused;
  }
  if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
    if (gameOver) { startGame(); showScreen(gameDiv); }
  }
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowDown') softDropping = false;
});

// Swipes
(function() {
  const el = canvas;
  let sx = 0, sy = 0, st = 0;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    const dt = Date.now() - st;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (dt > 500) return;
    if (absX < 20 && absY < 20) { playerRotate(1); return; }
    if (absX > absY) {
      if (dx > 30) playerMove(1);
      else if (dx < -30) playerMove(-1);
    } else {
      if (dy > 40) playerHardDrop();
      else if (dy < -40) playerHold();
    }
  }, { passive: true });
})();

// ===================== AUTH + FIREBASE =====================
const firebaseConfig = {
  apiKey: "AIzaSyB1N9wwPZh1vQkIt-V7by8FW-7xoZobsDg",
  authDomain: "tetris2-71bfa.firebaseapp.com",
  databaseURL: "https://tetris2-71bfa-default-rtdb.firebaseio.com",
  projectId: "tetris2-71bfa",
  storageBucket: "tetris2-71bfa.appspot.com",
  messagingSenderId: "38355194193",
  appId: "1:38355194193:web:93229f575c86111a8f7af0"
};

function hashPassSync(pass) {
  // Works on mobile file:// without crypto.subtle
  let h1 = 5381, h2 = 52711;
  const s = 'tetris:v2:' + String(pass);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1) ^ c;
    h2 = ((h2 << 5) + h2) + c;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
async function hashPass(pass) {
  try {
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      const data = new TextEncoder().encode('tetris:' + pass);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  return hashPassSync(pass);
}

function sanitizeLogin(login) {
  return String(login || '').trim().replace(/\s+/g, '_').slice(0, 16);
}

function updateOnlineUI(n) {
  document.querySelectorAll('.online-count-menu').forEach(el => {
    el.textContent = String(n);
  });
}

function updateUserBar() {
  const nameEl = document.getElementById('user-name-display');
  if (nameEl) nameEl.textContent = currentUser ? currentUser.login : 'Гость';
}

function clearPresenceNow() {
  try {
    if (window._presenceBeat) {
      clearInterval(window._presenceBeat);
      window._presenceBeat = null;
    }
    if (presenceRef) {
      try { presenceRef.onDisconnect().cancel(); } catch (e) {}
      // remove immediately so others see count drop now
      presenceRef.remove();
      presenceRef = null;
    }
  } catch (e) {}
}

function setPresence(status) {
  if (!presenceRef || !currentUser) return;
  try {
    presenceRef.set({
      login: currentUser.login,
      uid: fbKey(currentUser.uid),
      status: status || 'online',
      ts: Date.now()
    });
  } catch (e) {}
}

function startPresence() {
  if (!dbRef || !currentUser) return;
  try {
    clearPresenceNow();
    const key = String(currentUser.uid || currentUser.login).replace(/[.#$\[\]]/g, '_');
    presenceRef = dbRef.ref('/presence/' + key);
    // server removes node as soon as connection drops
    presenceRef.onDisconnect().remove();
    setPresence('online');
    if (window._presenceBeat) clearInterval(window._presenceBeat);
    window._presenceBeat = setInterval(() => {
      setPresence(gameMode === 'duel' && !paused ? 'in_game' : 'online');
    }, 10000);
  } catch (e) { console.warn('presence', e); }
}

// leave immediately on tab close / hide / refresh
function forceLogoutSession(reason) {
  try { clearPresenceNow(); } catch(e) {}
  try {
    if (dbRef && currentUser && !currentUser.guest) {
      dbRef.ref('/sessions/' + fbKey(currentUser.uid)).remove();
    }
  } catch(e) {}
  if (window._sessionUnsub) { try { window._sessionUnsub(); } catch(e) {} }
  if (window._sessionBeat) clearInterval(window._sessionBeat);
  if (inviteUnsub) { try { inviteUnsub(); } catch(e) {} }
  currentUser = null;
  localStorage.removeItem('tetrisSession');
  applyUserData(defaultUserData());
  updateUserBar();
  updateOnlineUI(0);
  clearStickyToast();
  // leave game
  paused = true;
  gameOver = true;
  showScreen(document.getElementById('auth-screen'));
}

function bindPresenceUnload() {
  if (window._presenceUnloadBound) return;
  window._presenceUnloadBound = true;
  const leave = () => {
    try {
      if (presenceRef) {
        presenceRef.onDisconnect().cancel();
        presenceRef.remove();
      }
    } catch (e) {}
    // require re-login after close / refresh
    try { localStorage.removeItem('tetrisSession'); } catch(e) {}
  };
  window.addEventListener('pagehide', leave);
  window.addEventListener('beforeunload', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // switching tab / minimizing → logout
      if (currentUser) forceLogoutSession('hidden');
    }
  });
}

function listenOnlineCount() {
  if (window._onlineListening) return;
  if (!dbRef) {
    updateOnlineUI(currentUser ? 1 : 0);
    return;
  }
  window._onlineListening = true;
  const STALE_MS = 20000; // backup if onDisconnect failed
  try {
    dbRef.ref('/presence').on('value', snap => {
      let n = 0;
      const now = Date.now();
      const seen = new Set();
      snap.forEach(c => {
        const v = c.val();
        if (!v || typeof v !== 'object') return;
        const ts = v.ts || 0;
        if (!ts || now - ts > STALE_MS) {
          try { c.ref.remove(); } catch (e) {}
          return;
        }
        const id = String(v.uid || c.key);
        if (seen.has(id)) return;
        seen.add(id);
        n++;
      });
      updateOnlineUI(n);
    }, err => {
      console.warn('online', err);
      updateOnlineUI(currentUser ? 1 : 0);
      window._onlineListening = false;
    });
  } catch (e) {
    console.warn('online listen', e);
    updateOnlineUI(currentUser ? 1 : 0);
    window._onlineListening = false;
  }
}

function listenInvites() {
  if (!dbRef || !currentUser || currentUser.guest) return;
  try {
    if (inviteUnsub) { try { inviteUnsub(); } catch(e) {} }
    const myId = fbKey(currentUser.uid);
    const ref = dbRef.ref('/duelInvites/' + myId);
    const handler = snap => {
      const box = ensureInviteBox();
      let html = '';
      snap.forEach(c => {
        const v = c.val();
        if (!v || v.status !== 'pending') return;
        const from = c.key;
        html += `<div>
          <b>${v.fromName || 'Игрок'}</b> вызывает на дуэль
          <div class="inv-actions">
            <button type="button" class="btn-accept" data-from="${from}" data-name="${(v.fromName||'').replace(/"/g,'')}">Принять</button>
            <button type="button" class="btn-decline" data-from="${from}">Отклонить</button>
          </div>
        </div>`;
      });
      if (html) {
        box.innerHTML = html;
        box.style.display = 'block';
        box.querySelectorAll('.btn-accept').forEach(btn => {
          btn.onclick = () => acceptInvite(btn.getAttribute('data-from'), btn.getAttribute('data-name'));
        });
        box.querySelectorAll('.btn-decline').forEach(btn => {
          btn.onclick = () => declineInvite(btn.getAttribute('data-from'));
        });
      } else {
        box.style.display = 'none';
        box.innerHTML = '';
      }
    };
    ref.on('value', handler);
    inviteUnsub = () => ref.off('value', handler);
  } catch (e) { console.warn('invites', e); }
}

async function registerUser(login, pass) {
  login = sanitizeLogin(login);
  if (login.length < 3) throw new Error('Логин минимум 3 символа');
  if (pass.length < 4) throw new Error('Пароль минимум 4 символа');
  if (!dbRef) throw new Error('Нужен интернет для регистрации');
  const hash = await hashPass(pass);
  const key = login.toLowerCase();
  const uid = 'u_' + fbKey(key);
  const userRef = dbRef.ref('/accounts/' + fbKey(key));
  const snap = await userRef.once('value');
  if (snap.exists()) throw new Error('Логин уже занят');
  await userRef.set({ hash, uid, login, created: Date.now() });
  // empty cloud profile
  await dbRef.ref('/userdata/' + fbKey(uid)).set({
    highScore: 0, balance: 0, bought: {}, stats: {
      totalLines: 0, bestScore: 0, tetrises: 0, maxCombo: 0,
      maxLevel: 1, sprints: 0, themesBought: 0, casesOpened: 0,
      tspins: 0, gamesPlayed: 0, duelWins: 0, unlocked: {}
    }, quests: null, seasonClaimed: {}, caseAvailableAt: 0, updatedAt: Date.now()
  });
  return { login, uid, guest: false };
}

async function loginUser(login, pass) {
  login = sanitizeLogin(login);
  if (!login || !pass) throw new Error('Введите логин и пароль');
  if (!dbRef) throw new Error('Нужен интернет для входа');
  const hash = await hashPass(pass);
  const key = login.toLowerCase();
  const snap = await dbRef.ref('/accounts/' + fbKey(key)).once('value');
  const data = snap.val();
  if (!data) throw new Error('Аккаунт не зарегистрирован');
  if (data.hash !== hash) throw new Error('Неверный логин или пароль');
  const user = { login: data.login || login, uid: data.uid || ('u_' + fbKey(key)), guest: false };

  const deviceId = getDeviceId();
  const sessRef = dbRef.ref('/sessions/' + fbKey(user.uid));
  const sess = await sessRef.once('value');
  const s = sess.val();
  const now = Date.now();
  if (s && s.deviceId && s.deviceId !== deviceId && s.ts && now - s.ts < 120000) {
    throw new Error('Аккаунт уже используется на другом устройстве');
  }
  await sessRef.set({ deviceId, login: user.login, ts: now });
  sessRef.onDisconnect().remove();
  return user;
}

function watchSessionKick() {
  if (!dbRef || !currentUser || currentUser.guest) return;
  try {
    if (window._sessionUnsub) { try { window._sessionUnsub(); } catch(e) {} }
    const deviceId = getDeviceId();
    const ref = dbRef.ref('/sessions/' + fbKey(currentUser.uid));
    const handler = s => {
      const v = s.val();
      if (!v) return;
      if (v.deviceId && v.deviceId !== deviceId) {
        toast('Вход с другого устройства — сессия завершена');
        logout();
      } else if (v.deviceId === deviceId) {
        // heartbeat session
        ref.update({ ts: Date.now() });
      }
    };
    ref.on('value', handler);
    window._sessionUnsub = () => ref.off('value', handler);
    if (window._sessionBeat) clearInterval(window._sessionBeat);
    window._sessionBeat = setInterval(() => {
      if (currentUser && dbRef) {
        dbRef.ref('/sessions/' + fbKey(currentUser.uid)).update({ ts: Date.now(), deviceId: getDeviceId() });
      }
    }, 30000);
  } catch (e) {}
}

function loginAsGuest() {
  const id = Math.random().toString(36).slice(2, 9);
  return { login: 'Гость_' + id.slice(0, 4), uid: 'guest_' + id, guest: true };
}

async function onLoggedIn(user) {
  currentUser = user;
  localStorage.setItem('tetrisSession', JSON.stringify({ login: user.login, uid: user.uid, guest: !!user.guest }));
  localStorage.setItem('tetrisName', user.login);
  updateUserBar();
  if (user.guest) {
    applyUserData(defaultUserData());
  } else {
    await loadUserData(user.uid);
  }
  try { startPresence(); } catch (e) {}
  try { listenInvites(); } catch (e) {}
  try { listenOnlineCount(); } catch (e) {}
  try { watchSessionKick(); } catch (e) {}
  showScreen(modeScreen);
  // ensure visible on mobile
  const ms = document.getElementById('mode-screen');
  if (ms) {
    ms.style.display = 'flex';
    ms.style.opacity = '1';
    ms.classList.add('active-screen');
  }
  const as = document.getElementById('auth-screen');
  if (as) {
    as.style.display = 'none';
    as.classList.remove('active-screen');
  }
  toast('Привет, ' + user.login + '!');
}

function logout() {
  clearStickyToast();
  window._quickSearching = false;
  clearPresenceNow();
  if (inviteUnsub) { try { inviteUnsub(); } catch(e) {} }
  if (window._sessionUnsub) { try { window._sessionUnsub(); } catch(e) {} }
  if (window._sessionBeat) clearInterval(window._sessionBeat);
  try {
    if (dbRef && currentUser && !currentUser.guest) {
      dbRef.ref('/sessions/' + fbKey(currentUser.uid)).remove();
    }
  } catch(e) {}
  currentUser = null;
  localStorage.removeItem('tetrisSession');
  updateUserBar();
  updateOnlineUI(0);
  showScreen(document.getElementById('auth-screen'));
}

function bindAuthUI() {
  let mode = 'login';
  const pass2 = document.getElementById('auth-pass2');
  const err = document.getElementById('auth-error');
  const submit = document.getElementById('auth-submit');
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.getAttribute('data-tab');
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      const p2w = document.getElementById('auth-pass2-wrap');
      if (pass2) pass2.style.display = mode === 'register' ? '' : 'none';
      if (p2w) p2w.style.display = mode === 'register' ? '' : 'none';
      if (submit) submit.textContent = mode === 'register' ? 'Зарегистрироваться' : 'Войти';
      const sub = document.getElementById('auth-subtitle');
      if (sub) sub.textContent = mode === 'register' ? 'создай аккаунт' : 'вход в аккаунт';
      if (err) err.textContent = '';
    });
  });
  function clearAuthError() {
    if (err) { err.textContent = ''; err.hidden = true; }
  }
  async function doAuth(e) {
    if (e) e.preventDefault();
    clearAuthError();
    const login = (document.getElementById('auth-login')?.value || '').trim();
    const pass = document.getElementById('auth-pass')?.value || '';
    const p2 = document.getElementById('auth-pass2')?.value || '';
    try {
      let user;
      if (mode === 'register') {
        if (pass !== p2) throw new Error('Пароли не совпадают');
        user = await registerUser(login, pass);
      } else {
        user = await loginUser(login, pass);
      }
      clearAuthError();
      onLoggedIn(user);
    } catch (ex) {
      console.error(ex);
      clearAuthError();
      toast(ex.message || 'Ошибка входа');
    }
  }
  document.getElementById('auth-form')?.addEventListener('submit', doAuth);
  document.getElementById('auth-submit')?.addEventListener('click', (e) => {
    // mobile sometimes skips submit
    const form = document.getElementById('auth-form');
    if (form && !form.checkValidity()) {
      form.reportValidity();
      return;
    }
    doAuth(e);
  });
  document.getElementById('auth-guest')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearAuthError();
    onLoggedIn(loginAsGuest());
  });
  document.getElementById('auth-guest')?.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearAuthError();
    onLoggedIn(loginAsGuest());
  }, { passive: false });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.querySelectorAll('.pass-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-target');
      const input = document.getElementById(id);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
    });
  });
}

// ===================== DUEL LOBBY =====================
function openDuelLobby() {
  if (!currentUser) {
    toast('Сначала войди в аккаунт');
    showScreen(document.getElementById('auth-screen'));
    return;
  }
  const sc = document.getElementById('duel-lobby-screen');
  showScreen(sc);
  if (sc) {
    sc.style.display = 'flex';
    sc.classList.add('active-screen');
  }
  try { setPresence('searching'); } catch (e) {}
  refreshPlayerList();
  // ensure invite UI exists even outside lobby
  ensureInviteBox();
}

function ensureInviteBox() {
  let box = document.getElementById('duel-incoming');
  if (!box) {
    box = document.createElement('div');
    box.id = 'duel-incoming';
    box.className = 'duel-incoming';
    box.style.display = 'none';
    document.body.appendChild(box);
  }
  return box;
}

function renderPlayersList(players) {
  const list = document.getElementById('duel-players-list');
  if (!list) return;
  if (!players.length) {
    list.innerHTML = '<div class="list-item"><div class="li-desc">Нет игроков онлайн. Подожди или обнови список.</div></div>';
    return;
  }
  list.innerHTML = players.map(p => {
    const st = p.status === 'in_game' ? 'в игре' : p.status === 'searching' ? 'ищет дуэль' : 'онлайн';
    const busy = p.status === 'in_game';
    const uid = fbKey(p.uid || p.login);
    return `<div class="list-item">
      <div class="li-body" style="flex:1">
        <div class="li-name">${p.login}</div>
        <div class="player-status ${busy ? 'busy' : ''}">${st}</div>
      </div>
      <button type="button" class="challenge-btn" data-uid="${uid}" data-name="${(p.login||'').replace(/"/g,'')}" ${busy ? 'disabled' : ''}>Вызвать</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.challenge-btn').forEach(btn => {
    btn.onclick = () => challengePlayer(btn.getAttribute('data-uid'), btn.getAttribute('data-name'));
  });
}

function refreshPlayerList() {
  const list = document.getElementById('duel-players-list');
  if (!list) return;
  const q = (document.getElementById('duel-search')?.value || '').trim().toLowerCase();
  list.innerHTML = '<div class="list-item"><div class="li-desc">Загрузка игроков...</div></div>';
  if (!dbRef) {
    list.innerHTML = '<div class="list-item"><div class="li-desc">Нет сети — дуэль только онлайн</div></div>';
    return;
  }
  const myId = fbKey(currentUser.uid);
  dbRef.ref('/presence').once('value').then(snap => {
    const players = [];
    const now = Date.now();
    snap.forEach(c => {
      const v = c.val();
      if (!v || !v.login) return;
      const id = fbKey(v.uid || c.key);
      if (id === myId) return;
      if (v.ts && now - v.ts > 45000) return;
      if (q && !String(v.login).toLowerCase().includes(q)) return;
      players.push({ login: v.login, uid: id, status: v.status || 'online', ts: v.ts });
    });
    players.sort((a, b) => String(a.login).localeCompare(String(b.login)));
    renderPlayersList(players);
  }).catch(() => {
    list.innerHTML = '<div class="list-item"><div class="li-desc">Ошибка загрузки списка</div></div>';
  });
}

function challengePlayer(uid, name) {
  if (!dbRef || !currentUser || !uid) return;
  if (currentUser.guest) {
    toast('Для вызова нужна регистрация');
    return;
  }
  const myId = fbKey(currentUser.uid);
  const theirId = fbKey(uid);
  // Create room first — both will watch this room
  const roomId = dbRef.ref('/duelRooms').push().key;
  const room = {
    host: myId,
    hostName: currentUser.login,
    guest: theirId,
    guestName: name || 'Игрок',
    hostScore: 0,
    guestScore: 0,
    status: 'pending',
    target: settings.duelTarget || 5000,
    ts: Date.now()
  };
  dbRef.ref('/duelRooms/' + roomId).set(room).then(() => {
    // invite to opponent
    return dbRef.ref('/duelInvites/' + theirId + '/' + myId).set({
      fromName: currentUser.login,
      fromUid: myId,
      roomId,
      status: 'pending',
      ts: Date.now()
    });
  }).then(() => {
    toast('Вызов отправлен: ' + name + ' — ждём...');
    // Challenger watches room → when active, enter game
    if (window._roomWaitUnsub) { try { window._roomWaitUnsub(); } catch(e) {} }
    const roomRef = dbRef.ref('/duelRooms/' + roomId);
    const handler = (s) => {
      const v = s.val();
      if (!v) return;
      if (v.status === 'active') {
        roomRef.off('value', handler);
        window._roomWaitUnsub = null;
        startDuelWithRoom(roomId, v);
      } else if (v.status === 'declined' || v.status === 'cancelled') {
        roomRef.off('value', handler);
        window._roomWaitUnsub = null;
        try { roomRef.remove(); } catch(e) {}
        toast(v.status === 'declined' ? 'Вызов отклонён' : 'Вызов отменён');
      }
    };
    roomRef.on('value', handler);
    window._roomWaitUnsub = () => roomRef.off('value', handler);
    setTimeout(() => {
      if (window._roomWaitUnsub) {
        try { window._roomWaitUnsub(); } catch(e) {}
        window._roomWaitUnsub = null;
        roomRef.once('value').then(s => {
          const v = s.val();
          if (v && v.status === 'pending') {
            roomRef.update({ status: 'cancelled' });
            try { dbRef.ref('/duelInvites/' + theirId + '/' + myId).remove(); } catch(e) {}
          }
        });
      }
    }, 60000);
  }).catch((e) => {
    console.warn(e);
    toast('Не удалось отправить вызов');
  });
}

function declineInvite(fromUid) {
  if (!dbRef || !currentUser) return;
  const myId = fbKey(currentUser.uid);
  const theirId = fbKey(fromUid);
  dbRef.ref('/duelInvites/' + myId + '/' + theirId).once('value').then(s => {
    const v = s.val();
    if (v && v.roomId) {
      dbRef.ref('/duelRooms/' + v.roomId).update({ status: 'declined' });
    }
    dbRef.ref('/duelInvites/' + myId + '/' + theirId).remove();
  });
}

function acceptInvite(fromUid, fromName) {
  if (!dbRef || !currentUser) return;
  const myId = fbKey(currentUser.uid);
  const theirId = fbKey(fromUid);
  const invRef = dbRef.ref('/duelInvites/' + myId + '/' + theirId);
  invRef.once('value').then(s => {
    const inv = s.val();
    if (!inv || !inv.roomId) {
      toast('Вызов устарел');
      invRef.remove();
      return;
    }
    const roomId = inv.roomId;
    const roomRef = dbRef.ref('/duelRooms/' + roomId);
    return roomRef.update({
      status: 'active',
      guest: myId,
      guestName: currentUser.login,
      guestScore: 0,
      ts: Date.now()
    }).then(() => invRef.remove()).then(() => {
      return roomRef.once('value');
    }).then(rs => {
      startDuelWithRoom(roomId, rs.val());
    });
  }).catch((e) => {
    console.warn(e);
    toast('Не удалось принять вызов');
  });
}

function startDuelWithRoom(roomId, room) {
  if (!roomId) return;
  // prevent double-start
  if (window._duelStarting) return;
  window._duelStarting = true;
  setTimeout(() => { window._duelStarting = false; }, 1500);

  if (window._botTimer) { clearInterval(window._botTimer); window._botTimer = null; }
  if (window._roomWaitUnsub) { try { window._roomWaitUnsub(); } catch(e) {} window._roomWaitUnsub = null; }

  duelId = roomId;
  gameMode = 'duel';
  duelOppScore = 0;
  ensureAudio();
  try { startGame(); } catch (e) { console.error(e); }
  stopDuelListenersOnly();

  if (dbRef) {
    const ref = dbRef.ref('/duelRooms/' + roomId);
    const handler = s => {
      const v = s.val();
      if (!v) return;
      const myId = currentUser ? fbKey(currentUser.uid) : '';
      const isHost = myId && String(v.host) === myId;
      const myScoreCloud = isHost ? (v.hostScore || 0) : (v.guestScore || 0);
      duelOppScore = isHost ? (v.guestScore || 0) : (v.hostScore || 0);
      const el = document.getElementById('duel-opp');
      if (el) el.textContent = String(duelOppScore);
      const target = settings.duelTarget || 5000;

      if (gameOver) return;

      // Opponent finished the duel for both
      if (v.status === 'finished') {
        duelOppScore = isHost ? (v.guestScore || 0) : (v.hostScore || 0);
        endGame(String(v.winner) === String(myId));
        return;
      }

      // Opponent reached target first
      if (duelOppScore >= target && score < target) {
        try {
          ref.update({
            status: 'finished',
            winner: isHost ? v.guest : v.host,
            hostScore: isHost ? score : duelOppScore,
            guestScore: isHost ? duelOppScore : score
          });
        } catch(e) {}
        endGame(false);
      }
    };
    ref.on('value', handler);
    duelUnsub = () => ref.off('value', handler);
  }

  showScreen(gameDiv);
  if (gameDiv) {
    gameDiv.style.display = 'flex';
    gameDiv.classList.add('active-screen');
  }
  paused = false;
  gameOver = false;
  const dc = document.getElementById('duel-card');
  if (dc) dc.style.display = '';
  const el = document.getElementById('duel-opp');
  if (el) el.textContent = '0';
  const dt = document.getElementById('duel-target-val');
  if (dt) dt.textContent = String(settings.duelTarget || 5000);
  try { setPresence('in_game'); } catch (e) {}
  toast('⚔️ Дуэль началась!');
}

function stopDuelListenersOnly() {
  if (duelUnsub) { try { duelUnsub(); } catch(e) {} duelUnsub = null; }
}

const _publishDuelScoreOrig = typeof publishDuelScore === 'function' ? publishDuelScore : null;
publishDuelScore = function() {
  if (gameMode !== 'duel' || !duelId) return;
  if (dbRef && currentUser) {
    try {
      const myId = fbKey(currentUser.uid);
      const ref = dbRef.ref('/duelRooms/' + duelId);
      ref.once('value').then(s => {
        const v = s.val();
        if (!v) {
          if (_publishDuelScoreOrig) _publishDuelScoreOrig();
          return;
        }
        if (String(v.host) === myId) ref.update({ hostScore: score });
        else if (String(v.guest) === myId) ref.update({ guestScore: score });
      });
      return;
    } catch (e) {}
  }
  if (_publishDuelScoreOrig) _publishDuelScoreOrig();
};

function quickMatch() {
  if (!currentUser) {
    toast('Сначала войди');
    return;
  }
  if (!dbRef) {
    toast('Нужна сеть для дуэли');
    return;
  }
  if (currentUser.guest) {
    toast('Для дуэли нужна регистрация');
    return;
  }
  if (window._quickSearching) return;
  window._quickSearching = true;
  toast('⚡ Ищем игрока...', { sticky: true });
  setPresence('searching');
  const myId = fbKey(currentUser.uid);
  const waiting = dbRef.ref('/duelWaiting');

  const cleanupWait = (ref) => {
    try { if (ref) ref.remove(); } catch(e) {}
    if (window._quickHandler && ref) {
      try { ref.off('value', window._quickHandler); } catch(e) {}
      window._quickHandler = null;
    }
  };

  waiting.once('value').then(snap => {
    let joined = false;
    snap.forEach(child => {
      if (joined) return;
      const v = child.val();
      if (v && v.status === 'waiting' && String(v.host) !== myId) {
        joined = true;
        const roomId = child.key;
        const room = {
          host: v.host,
          hostName: v.hostName || 'Игрок',
          guest: myId,
          guestName: currentUser.login,
          hostScore: 0,
          guestScore: 0,
          status: 'active',
          target: settings.duelTarget || 5000,
          ts: Date.now()
        };
        child.ref.update({ status: 'matched', guest: myId, guestName: currentUser.login }).then(() => {
          return dbRef.ref('/duelRooms/' + roomId).set(room);
        }).then(() => {
          window._quickSearching = false;
          clearStickyToast();
          toast('Соперник найден!');
          startDuelWithRoom(roomId, room);
        });
      }
    });
    if (!joined) {
      const ref = waiting.push({
        host: myId,
        hostName: currentUser.login,
        status: 'waiting',
        ts: Date.now()
      });
      const handler = s => {
        const v = s.val();
        if (!v) return;
        if ((v.status === 'matched' || v.status === 'active') && v.guest) {
          ref.off('value', handler);
          window._quickHandler = null;
          const roomId = ref.key;
          const room = {
            host: myId,
            hostName: currentUser.login,
            guest: v.guest,
            guestName: v.guestName || 'Игрок',
            hostScore: 0,
            guestScore: 0,
            status: 'active',
            target: settings.duelTarget || 5000,
            ts: Date.now()
          };
          dbRef.ref('/duelRooms/' + roomId).set(room).then(() => {
            try { ref.remove(); } catch(e) {}
            window._quickSearching = false;
            clearStickyToast();
            toast('Соперник найден!');
            startDuelWithRoom(roomId, room);
          });
        }
      };
      window._quickHandler = handler;
      ref.on('value', handler);
      // keep sticky toast until match; cancel after 2 min
      setTimeout(() => {
        if (window._quickSearching) {
          window._quickSearching = false;
          cleanupWait(ref);
          clearStickyToast();
          toast('Никого не найдено');
          setPresence('online');
        }
      }, 120000);
    }
  }).catch(() => {
    window._quickSearching = false;
    clearStickyToast();
    toast('Ошибка поиска');
  });
}

function bindDuelLobbyUI() {
  document.getElementById('duel-lobby-back')?.addEventListener('click', () => {
    setPresence('online');
    showScreen(modeScreen);
  });
  document.getElementById('duel-refresh')?.addEventListener('click', refreshPlayerList);
  document.getElementById('duel-search')?.addEventListener('input', () => {
    clearTimeout(window._duelSearchT);
    window._duelSearchT = setTimeout(refreshPlayerList, 250);
  });
  document.getElementById('duel-quick')?.addEventListener('click', quickMatch);
}

// duel handled in startModeFromCard

// ===================== INIT =====================
updateScore();
updateBalance();
updateCaseTimer();
setupThemeOfDay();
bindSettings();
updateProfileUI();
bindAuthUI();
bindDuelLobbyUI();
update();

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    dbRef = firebase.database();
    firebaseReady = true;
    listenOnlineCount();
    bindPresenceUnload();
  } else {
    console.warn('Firebase SDK not loaded');
    updateOnlineUI(0);
  }
} catch (e) {
  console.warn('Firebase', e);
  updateOnlineUI(0);
}

// restore session
try {
  const sess = JSON.parse(localStorage.getItem('tetrisSession') || 'null');
  // always require login after open / refresh
  localStorage.removeItem('tetrisSession');
  currentUser = null;
  applyUserData(defaultUserData());
  showScreen(document.getElementById('auth-screen'));
} catch (e) {
  showScreen(document.getElementById('auth-screen'));
}

