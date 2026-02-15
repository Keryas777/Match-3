/* Match-3 V3+ : Bonus + Niveaux + Objectifs + FX + Modal victoire */

/* --- iOS: block pinch-to-zoom / double-tap zoom --- */
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

let __lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const t = Date.now();
  if (t - __lastTouchEnd <= 300) e.preventDefault();
  __lastTouchEnd = t;
}, { passive: false });

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const el = {
  level: document.getElementById("level"),
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  moves: document.getElementById("moves"),
  objectives: document.getElementById("objectives"),
  status: document.getElementById("status"),
  newGame: document.getElementById("newGame"),

  winModal: document.getElementById("winModal"),
  winText: document.getElementById("winText"),
  winRestart: document.getElementById("winRestart"),
  winNext: document.getElementById("winNext"),
};

const GRID = 8;
const TYPES = 6;

const PADDING = 18;
const BOARD_SIZE = canvas.width - PADDING * 2;
const CELL = BOARD_SIZE / GRID;

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#14b8a6"];
const COLOR_NAMES = ["Rouge", "Orange", "Vert", "Bleu", "Violet", "Turquoise"];

const CFG = {
  swapMs: 140,
  fallMs: 170,
  popMs: 150,
  chainDelay: 40,

  fxBurstMs: 420,
  fxFlashMs: 160,
  shakeMs: 220,
};

const SAVE_KEY = "match3_v3_save";

const LEVELS = [
  { moves: 20, targetScore: 800,  collect: { 0: 12, 3: 10 }, ice: 8  },
  { moves: 22, targetScore: 1200, collect: { 2: 14, 5: 12 }, ice: 12 },
  { moves: 25, targetScore: 1800, collect: { 1: 18, 4: 14 }, ice: 16 },
];

let state = "IDLE"; // IDLE | BUSY | GAMEOVER | WIN
let pieces = [];
let ice = []; // 0/1
let score = 0;
let best = 0;

let levelIndex = 0;
let movesLeft = 0;
let targetScore = 0;
let objectives = { collect: {}, iceLeft: 0 };

let input = { down: false, start: null, locked: false };
let lastSwap = null;

// ===== FX layer (burst/flash/shake) =====
const fx = {
  bursts: [], // {x,y,color,intensity,t0,dur}
  flash: null, // {t0,dur,intensity}
  shake: null, // {t0,dur,intensity}
};

function now() { return performance.now(); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function inBounds(r, c) { return r >= 0 && r < GRID && c >= 0 && c < GRID; }
function keyOf(r, c) { return `${r},${c}`; }

function xyFromCell(r, c) {
  return { x: PADDING + c * CELL + CELL / 2, y: PADDING + r * CELL + CELL / 2 };
}

function cellFromXY(x, y) {
  const bx = x - PADDING;
  const by = y - PADDING;
  const c = Math.floor(bx / CELL);
  const r = Math.floor(by / CELL);
  if (!inBounds(r, c)) return null;
  return { r, c };
}

function randType() { return Math.floor(Math.random() * TYPES); }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function addBurst(r, c, type, intensity = 1) {
  const { x, y } = xyFromCell(r, c);
  fx.bursts.push({
    x, y,
    color: COLORS[type],
    intensity,
    t0: now(),
    dur: CFG.fxBurstMs,
  });
}

function addFlash(intensity = 1) {
  fx.flash = { t0: now(), dur: CFG.fxFlashMs, intensity };
}

function addShake(intensity = 1) {
  fx.shake = { t0: now(), dur: CFG.shakeMs, intensity };
}

function drawFX() {
  // bursts
  const t = now();
  fx.bursts = fx.bursts.filter(b => t < b.t0 + b.dur);

  for (const b of fx.bursts) {
    const p = clamp((t - b.t0) / b.dur, 0, 1);
    const e = easeOutCubic(p);

    // ring
    const ringR = (CELL * 0.15 + CELL * 0.65 * e) * b.intensity;
    ctx.globalAlpha = (1 - p) * 0.55;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // rays
    const rays = Math.floor(10 + 10 * b.intensity);
    ctx.globalAlpha = (1 - p) * 0.7;
    ctx.lineWidth = 2;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const r1 = ringR * 0.35;
      const r2 = ringR * 1.05;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
      ctx.lineTo(b.x + Math.cos(a) * r2, b.y + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // flash overlay
  if (fx.flash) {
    const p = clamp((t - fx.flash.t0) / fx.flash.dur, 0, 1);
    const a = (1 - p) * 0.25 * fx.flash.intensity;
    if (a > 0.001) {
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);
      ctx.globalAlpha = 1;
    } else {
      fx.flash = null;
    }
  }
}

function getShakeOffset() {
  if (!fx.shake) return { dx: 0, dy: 0 };
  const t = now();
  const p = clamp((t - fx.shake.t0) / fx.shake.dur, 0, 1);
  const a = (1 - p) * 6 * fx.shake.intensity;
  if (p >= 1) { fx.shake = null; return { dx: 0, dy: 0 }; }
  // pseudo random jitter
  const dx = (Math.sin(t * 0.08) + Math.sin(t * 0.13)) * 0.5 * a;
  const dy = (Math.cos(t * 0.09) + Math.cos(t * 0.11)) * 0.5 * a;
  return { dx, dy };
}

function makePiece(r, c, type, special = null) {
  const { x, y } = xyFromCell(r, c);
  return {
    r, c,
    type,
    special, // null | "row" | "col" | "bomb" | "color"
    x, y,
    sx: x, sy: y,
    tx: x, ty: y,
    t0: 0, t1: 0,
    popping: false,
    popT0: 0, popT1: 0,
    active: true,
  };
}

function setPieceCell(p, r, c) {
  p.r = r; p.c = c;
  const { x, y } = xyFromCell(r, c);
  p.sx = p.x; p.sy = p.y;
  p.tx = x; p.ty = y;
}

function startMoveAnim(p, ms) {
  p.t0 = now();
  p.t1 = p.t0 + ms;
  p.sx = p.x; p.sy = p.y;
}

function startPop(p) {
  p.popping = true;
  p.popT0 = now();
  p.popT1 = p.popT0 + CFG.popMs;
}

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); }
  catch { return null; }
}

function saveGame() {
  try {
    const data = {
      best,
      levelIndex,
      score,
      movesLeft,
      targetScore,
      objectives,
      grid: pieces.map(row => row.map(p => p ? ({ t: p.type, s: p.special }) : null)),
      ice,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {}
}

function showWinModal() {
  el.winText.textContent = `Bravo ! Niveau ${levelIndex + 1} validé ✅`;
  el.winModal.classList.remove("hidden");
}

function hideWinModal() {
  el.winModal.classList.add("hidden");
}

function updateHUD(msg = "") {
  el.level.textContent = String(levelIndex + 1);
  el.score.textContent = String(score);
  el.best.textContent = String(best);
  el.moves.textContent = String(movesLeft);

  el.objectives.innerHTML = "";

  const liScore = document.createElement("li");
  liScore.textContent = `Atteindre ${targetScore} points (${score}/${targetScore})`;
  el.objectives.appendChild(liScore);

  for (const k of Object.keys(objectives.collect || {})) {
    const needed = objectives.collect[k];
    if (needed <= 0) continue;
    const li = document.createElement("li");
    li.textContent = `Collecter ${needed} ${COLOR_NAMES[Number(k)]}`;
    el.objectives.appendChild(li);
  }

  if (objectives.iceLeft > 0) {
    const liIce = document.createElement("li");
    liIce.textContent = `Casser la glace : ${objectives.iceLeft} restante(s)`;
    el.objectives.appendChild(liIce);
  }

  el.status.textContent = msg;
}

function resetBoardArrays() {
  pieces = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  ice = Array.from({ length: GRID }, () => Array(GRID).fill(0));
}

function wouldMakeMatchAt(r, c, type) {
  const get = (rr, cc) => (inBounds(rr, cc) ? (pieces[rr][cc]?.type ?? null) : null);

  const l1 = get(r, c - 1) === type;
  const l2 = get(r, c - 2) === type;
  const r1 = get(r, c + 1) === type;
  const r2 = get(r, c + 2) === type;
  if ((l1 && l2) || (r1 && r2) || (l1 && r1)) return true;

  const u1 = get(r - 1, c) === type;
  const u2 = get(r - 2, c) === type;
  const d1 = get(r + 1, c) === type;
  const d2 = get(r + 2, c) === type;
  if ((u1 && u2) || (d1 && d2) || (u1 && d1)) return true;

  return false;
}

function buildNewBoardNoMatches() {
  resetBoardArrays();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      let t, guard = 0;
      do { t = randType(); guard++; if (guard > 60) break; }
      while (wouldMakeMatchAt(r, c, t));
      pieces[r][c] = makePiece(r, c, t, null);
    }
  }
}

function placeIce(count) {
  const cells = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) cells.push({ r, c });
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const n = Math.min(count, cells.length);
  for (let i = 0; i < n; i++) {
    const { r, c } = cells[i];
    ice[r][c] = 1;
  }
}

function draw() {
  const { dx, dy } = getShakeOffset();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(dx, dy);

  // board background
  ctx.fillStyle = "#0f1722";
  ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

  // grid + ICE (plus visible)
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      ctx.strokeStyle = "rgba(232,238,246,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(PADDING + c * CELL, PADDING + r * CELL, CELL, CELL);

      if (ice[r][c] === 1) {
        const x = PADDING + c * CELL;
        const y = PADDING + r * CELL;

        // base frost
        ctx.fillStyle = "rgba(180, 210, 255, 0.22)";
        ctx.fillRect(x, y, CELL, CELL);

        // inner glow border
        ctx.strokeStyle = "rgba(220, 240, 255, 0.55)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, CELL - 8, CELL - 8);

        // frost lines
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const t = (i + 1) / 5;
          ctx.beginPath();
          ctx.moveTo(x + CELL * t, y);
          ctx.lineTo(x + CELL, y + CELL * t);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(x, y + CELL * t);
          ctx.lineTo(x + CELL * t, y + CELL);
          ctx.stroke();
        }
      }
    }
  }

  // pieces
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const p = pieces[r][c];
      if (!p || !p.active) continue;

      // move anim
      if (p.t1 > p.t0) {
        const t = clamp((now() - p.t0) / (p.t1 - p.t0), 0, 1);
        const e = easeOutCubic(t);
        p.x = p.sx + (p.tx - p.sx) * e;
        p.y = p.sy + (p.ty - p.sy) * e;
        if (t >= 1) { p.x = p.tx; p.y = p.ty; p.t0 = p.t1 = 0; }
      }

      // pop anim scale
      let scale = 1;
      if (p.popping) {
        const t = clamp((now() - p.popT0) / (p.popT1 - p.popT0), 0, 1);
        scale = 1 - easeOutCubic(t);
        if (t >= 1) { p.active = false; p.popping = false; }
      }

      const radius = CELL * 0.33 * scale;
      if (radius <= 0.6) continue;

      // glow for specials
      if (p.special) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // base circle
      ctx.beginPath();
      ctx.fillStyle = COLORS[p.type];
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // shine
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.fillStyle = "#ffffff";
      ctx.arc(p.x - radius * 0.25, p.y - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // special marker
      if (p.special) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 3;

        if (p.special === "row" || p.special === "col") {
          ctx.beginPath();
          if (p.special === "row") {
            ctx.moveTo(p.x - radius, p.y);
            ctx.lineTo(p.x + radius, p.y);
          } else {
            ctx.moveTo(p.x, p.y - radius);
            ctx.lineTo(p.x, p.y + radius);
          }
          ctx.stroke();
        } else if (p.special === "bomb") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 0.55, 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.special === "color") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 0.65, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 0.3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  // selection highlight
  if (input.start) {
    const { r, c } = input.start;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    ctx.strokeRect(PADDING + c * CELL + 2, PADDING + r * CELL + 2, CELL - 4, CELL - 4);
  }

  // FX
  drawFX();

  ctx.restore();
}

function findMatchGroups() {
  const groups = [];

  // horizontal
  for (let r = 0; r < GRID; r++) {
    let runType = pieces[r][0]?.type ?? null;
    let runStart = 0;
    let runLen = 1;
    for (let c = 1; c <= GRID; c++) {
      const t = (c < GRID) ? (pieces[r][c]?.type ?? null) : Symbol("end");
      if (t === runType) runLen++;
      else