/* Match-3 V2 (Canvas) - Animations + Combos + Objectif + Sauvegarde */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const movesEl = document.getElementById("moves");
const targetEl = document.getElementById("target");
const newGameBtn = document.getElementById("newGame");

const GRID = 8;
const TYPES = 6;

const PADDING = 18;
const BOARD_SIZE = canvas.width - PADDING * 2;
const CELL = BOARD_SIZE / GRID;

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#14b8a6"];

const CFG = {
  movesStart: 30,
  targetScore: 1500,
  swapMs: 120,
  fallMs: 160,
  popMs: 140,
};

const STORAGE_KEY = "match3_v2_save";

let state = "IDLE"; // IDLE | SWAPPING | RESOLVING | GAMEOVER
let pieces = []; // 2D array of piece objects or null
let score = 0;
let best = 0;
let movesLeft = CFG.movesStart;
let targetScore = CFG.targetScore;
let combo = 1;

let input = { down: false, start: null, locked: false };

function now() { return performance.now(); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function inBounds(r, c) { return r >= 0 && r < GRID && c >= 0 && c < GRID; }
function keyOf(r, c) { return `${r},${c}`; }

function randType() {
  return Math.floor(Math.random() * TYPES);
}

function xyFromCell(r, c) {
  return {
    x: PADDING + c * CELL + CELL / 2,
    y: PADDING + r * CELL + CELL / 2,
  };
}

function cellFromXY(x, y) {
  const bx = x - PADDING;
  const by = y - PADDING;
  const c = Math.floor(bx / CELL);
  const r = Math.floor(by / CELL);
  if (!inBounds(r, c)) return null;
  return { r, c };
}

function makePiece(r, c, type) {
  const { x, y } = xyFromCell(r, c);
  return {
    r, c,
    type,
    x, y,
    sx: x, sy: y, // start anim pos
    tx: x, ty: y, // target anim pos
    t0: 0, t1: 0,
    pop: 0, // 0..1 pop anim
    popping: false,
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

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveGame() {
  try {
    const data = {
      best,
      score,
      movesLeft,
      targetScore,
      grid: pieces.map(row => row.map(p => (p ? p.type : null))),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function applySave(data) {
  best = Number(data.best ?? 0);
  score = Number(data.score ?? 0);
  movesLeft = Number(data.movesLeft ?? CFG.movesStart);
  targetScore = Number(data.targetScore ?? CFG.targetScore);

  // rebuild pieces
  pieces = Array.from({ length: GRID }, (_, r) =>
    Array.from({ length: GRID }, (_, c) => {
      const t = data.grid?.[r]?.[c];
      return (t == null) ? null : makePiece(r, c, t);
    })
  );

  // safety resolve if needed
  resolveAllNoAnim();
  updateHUD();
}

function updateHUD() {
  if (scoreEl) scoreEl.textContent = String(score);
  if (bestEl) bestEl.textContent = String(best);
  if (movesEl) movesEl.textContent = String(movesLeft);
  if (targetEl) targetEl.textContent = String(targetScore);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // board background
  ctx.fillStyle = "#0f1722";
  ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

  // grid + pieces
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      ctx.strokeStyle = "rgba(232,238,246,0.07)";
      ctx.lineWidth = 1;
      ctx.strokeRect(PADDING + c * CELL, PADDING + r * CELL, CELL, CELL);

      const p = pieces[r][c];
      if (!p || !p.active) continue;

      // animate position
      if (p.t1 > p.t0) {
        const t = clamp((now() - p.t0) / (p.t1 - p.t0), 0, 1);
        const e = easeOutCubic(t);
        p.x = p.sx + (p.tx - p.sx) * e;
        p.y = p.sy + (p.ty - p.sy) * e;
        if (t >= 1) {
          p.x = p.tx; p.y = p.ty;
          p.t0 = p.t1 = 0;
        }
      }

      // pop anim
      let scale = 1;
      if (p.popping) {
        const t = clamp((now() - p.popT0) / (p.popT1 - p.popT0), 0, 1);
        // shrink to 0
        scale = 1 - easeOutCubic(t);
        if (t >= 1) {
          p.active = false;
          p.popping = false;
        }
      }

      const radius = CELL * 0.33 * scale;
      if (radius <= 0.5) continue;

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
    }
  }

  // selection highlight
  if (input.start) {
    const { r, c } = input.start;
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 3;
    ctx.strokeRect(PADDING + c * CELL + 2, PADDING + r * CELL + 2, CELL - 4, CELL - 4);
  }

  // overlay game over / win
  if (state === "GAMEOVER") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);
    ctx.fillStyle = "#e8eef6";
    ctx.font = "700 28px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(
      score >= targetScore ? "Objectif atteint ! 🎉" : "Fin de partie",
      PADDING + BOARD_SIZE / 2,
      PADDING + BOARD_SIZE / 2 - 10
    );
    ctx.font = "600 18px system-ui";
    ctx.fillText("Appuie sur Nouvelle partie", PADDING + BOARD_SIZE / 2, PADDING + BOARD_SIZE / 2 + 24);
  }
}

function findMatches() {
  const clear = new Set();

  // horizontal
  for (let r = 0; r < GRID; r++) {
    let runType = pieces[r][0]?.type ?? null;
    let runStart = 0;
    let runLen = 1;

    for (let c = 1; c <= GRID; c++) {
      const t = (c < GRID) ? (pieces[r][c]?.type ?? null) : Symbol("end");
      if (t === runType) {
        runLen++;
      } else {
        if (runType != null && runLen >= 3) {
          for (let k = runStart; k < runStart + runLen; k++) clear.add(keyOf(r, k));
        }
        runType = (c < GRID) ? (pieces[r][c]?.type ?? null) : null;
        runStart = c;
        runLen = 1;
      }
    }
  }

  // vertical
  for (let c = 0; c < GRID; c++) {
    let runType = pieces[0][c]?.type ?? null;
    let runStart = 0;
    let runLen = 1;

    for (let r = 1; r <= GRID; r++) {
      const t = (r < GRID) ? (pieces[r][c]?.type ?? null) : Symbol("end");
      if (t === runType) {
        runLen++;
      } else {
        if (runType != null && runLen >= 3) {
          for (let k = runStart; k < runStart + runLen; k++) clear.add(keyOf(k, c));
        }
        runType = (r < GRID) ? (pieces[r][c]?.type ?? null) : null;
        runStart = r;
        runLen = 1;
      }
    }
  }

  return clear;
}

function wouldMakeMatchAt(r, c, type) {
  const get = (rr, cc) => (inBounds(rr, cc) ? (pieces[rr][cc]?.type ?? null) : null);

  // horizontal
  const l1 = get(r, c - 1) === type;
  const l2 = get(r, c - 2) === type;
  const r1 = get(r, c + 1) === type;
  const r2 = get(r, c + 2) === type;
  if ((l1 && l2) || (r1 && r2) || (l1 && r1)) return true;

  // vertical
  const u1 = get(r - 1, c) === type;
  const u2 = get(r - 2, c) === type;
  const d1 = get(r + 1, c) === type;
  const d2 = get(r + 2, c) === type;
  if ((u1 && u2) || (d1 && d2) || (u1 && d1)) return true;

  return false;
}

function buildNewBoardNoMatches() {
  pieces = Array.from({ length: GRID }, () => Array(GRID).fill(null));

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      let t;
      let guard = 0;
      do {
        t = randType();
        guard++;
        if (guard > 60) break;
      } while (wouldMakeMatchAt(r, c, t));
      pieces[r][c] = makePiece(r, c, t);
    }
  }
}

function swapPieces(a, b, animate = true) {
  const pa = pieces[a.r][a.c];
  const pb = pieces[b.r][b.c];
  pieces[a.r][a.c] = pb;
  pieces[b.r][b.c] = pa;

  if (pa) setPieceCell(pa, b.r, b.c);
  if (pb) setPieceCell(pb, a.r, a.c);

  if (animate) {
    if (pa) startMoveAnim(pa, CFG.swapMs);
    if (pb) startMoveAnim(pb, CFG.swapMs);
  }
}

function startPop(p) {
  p.popping = true;
  p.popT0 = now();
  p.popT1 = p.popT0 + CFG.popMs;
}

function applyGravityAndRefillAnimated() {
  // For each column, compact downward and animate falling
  let maxFallMs = 0;

  for (let c = 0; c < GRID; c++) {
    const col = [];
    for (let r = GRID - 1; r >= 0; r--) {
      const p = pieces[r][c];
      if (p && p.active) col.push(p);
    }

    // refill with new pieces from above
    while (col.length < GRID) {
      const spawnIndex = col.length; // 0..GRID-1
      const newR = -1 - spawnIndex; // start above the board
      const t = randType();
      const p = makePiece(newR, c, t);
      // place visually above
      const { x, y } = xyFromCell(0, c);
      p.x = x;
      p.y = PADDING + (newR * CELL) + CELL / 2;
      col.push(p);
    }

    // write back from bottom to top
    for (let r = GRID - 1; r >= 0; r--) {
      const p = col[GRID - 1 - r];
      pieces[r][c] = p;

      // animate to new cell
      setPieceCell(p, r, c);
      startMoveAnim(p, CFG.fallMs);

      maxFallMs = Math.max(maxFallMs, CFG.fallMs);
    }
  }

  return maxFallMs;
}

function resolveAllNoAnim() {
  // Safety resolve without animations (for loaded saves / init)
  while (true) {
    const clear = findMatches();
    if (clear.size === 0) break;

    for (const k of clear) {
      const [r, c] = k.split(",").map(Number);
      pieces[r][c] = null;
    }

    // gravity refill no anim
    for (let c = 0; c < GRID; c++) {
      const colTypes = [];
      for (let r = GRID - 1; r >= 0; r--) {
        const p = pieces[r][c];
        if (p) colTypes.push(p.type);
      }
      while (colTypes.length < GRID) colTypes.push(randType());
      for (let r = GRID - 1; r >= 0; r--) {
        pieces[r][c] = makePiece(r, c, colTypes[GRID - 1 - r]);
      }
    }
  }
}

function resolveWithAnimations() {
  state = "RESOLVING";
  combo = 1;

  const step = () => {
    const clear = findMatches();
    if (clear.size === 0) {
      state = "IDLE";
      input.locked = false;

      // end conditions
      if (score > best) best = score;
      updateHUD();
      saveGame();

      if (movesLeft <= 0 || score >= targetScore) {
        state = "GAMEOVER";
      }
      return;
    }

    // score with combo
    score += clear.size * 10 * combo;
    combo++;

    updateHUD();

    // pop anim
    for (const k of clear) {
      const [r, c] = k.split(",").map(Number);
      const p = pieces[r][c];
      if (p) startPop(p);
      pieces[r][c] = null; // remove from grid (visual pop still drawn by object if referenced elsewhere, but we keep it simple)
    }

    // wait pop then gravity
    setTimeout(() => {
      const fallMs = applyGravityAndRefillAnimated();
      // wait fall then next match check
      setTimeout(step, fallMs + 30);
    }, CFG.popMs + 30);
  };

  step();
}

function tryMove(from, to) {
  if (!from || !to) return;
  const dr = Math.abs(from.r - to.r);
  const dc = Math.abs(from.c - to.c);
  if (dr + dc !== 1) return;
  if (state !== "IDLE") return;

  // consume a move only if swap is valid (creates a match)
  input.locked = true;
  state = "SWAPPING";

  swapPieces(from, to, true);

  setTimeout(() => {
    const hasMatch = findMatches().size > 0;
    if (!hasMatch) {
      // swap back
      swapPieces(from, to, true);
      setTimeout(() => {
        state = "IDLE";
        input.locked = false;
      }, CFG.swapMs + 10);
      return;
    }

    // valid move
    movesLeft--;
    updateHUD();

    // resolve cascades
    setTimeout(() => resolveWithAnimations(), 20);
  }, CFG.swapMs + 10);
}

function canvasPosFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
  const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);
  return { x, y };
}

function onPointerDown(e) {
  if (input.locked || state === "GAMEOVER") return;
  e.preventDefault();
  const { x, y } = canvasPosFromEvent(e);
  const cell = cellFromXY(x, y);
  if (!cell) return;
  input.down = true;
  input.start = { ...cell, x, y };
}

function onPointerMove(e) {
  if (!input.down || input.locked || !input.start || state !== "IDLE") return;
  e.preventDefault();

  const { x, y } = canvasPosFromEvent(e);
  const dx = x - input.start.x;
  const dy = y - input.start.y;
  const threshold = CELL * 0.25;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

  let target = { r: input.start.r, c: input.start.c };
  if (Math.abs(dx) > Math.abs(dy)) target.c += (dx > 0) ? 1 : -1;
  else target.r += (dy > 0) ? 1 : -1;

  if (!inBounds(target.r, target.c)) {
    input.down = false;
    input.start = null;
    return;
  }

  // one swipe = one move attempt
  input.down = false;
  const from = { r: input.start.r, c: input.start.c };
  input.start = null;

  tryMove(from, target);
}

function onPointerUp() {
  input.down = false;
  input.start = null;
}

function newGame() {
  score = 0;
  movesLeft = CFG.movesStart;
  targetScore = CFG.targetScore;
  combo = 1;

  const saved = loadSave();
  best = Number(saved?.best ?? 0);

  buildNewBoardNoMatches();
  resolveAllNoAnim(); // safety

  state = "IDLE";
  input.locked = false;

  updateHUD();
  saveGame();
}

function maybeResume() {
  const data = loadSave();
  if (!data || !data.grid) {
    best = 0;
    updateHUD();
    newGame();
    return;
  }
  applySave(data);
  // If save already finished
  if (movesLeft <= 0 || score >= targetScore) state = "GAMEOVER";
}

function tick() {
  draw();
  requestAnimationFrame(tick);
}

canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
canvas.addEventListener("pointermove", onPointerMove, { passive: false });
canvas.addEventListener("pointerup", onPointerUp, { passive: true });
canvas.addEventListener("pointercancel", onPointerUp, { passive: true });

newGameBtn?.addEventListener("click", newGame);

maybeResume();
tick();