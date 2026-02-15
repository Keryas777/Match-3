/* Match-3 V3: Bonus + Niveaux + Objectifs (Canvas / Mobile / GitHub Pages) */

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
  nextLevel: document.getElementById("nextLevel"),
};

const GRID = 8;
const TYPES = 6;

const PADDING = 18;
const BOARD_SIZE = canvas.width - PADDING * 2;
const CELL = BOARD_SIZE / GRID;

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#14b8a6"];
const COLOR_NAMES = ["Rouge", "Orange", "Vert", "Bleu", "Violet", "Turquoise"];

// Bonus types: "row" | "col" | "bomb" | "color"
const CFG = {
  swapMs: 140,
  fallMs: 170,
  popMs: 150,
  chainDelay: 40,
};

const SAVE_KEY = "match3_v3_save";

/** Levels: tune freely */
const LEVELS = [
  {
    moves: 20,
    targetScore: 800,
    collect: { 0: 12, 3: 10 }, // 12 rouges, 10 bleus
    ice: 8, // nombre de cases "glace"
  },
  {
    moves: 22,
    targetScore: 1200,
    collect: { 2: 14, 5: 12 }, // verts, turquoises
    ice: 12,
  },
  {
    moves: 25,
    targetScore: 1800,
    collect: { 1: 18, 4: 14 },
    ice: 16,
  },
];

let state = "IDLE"; // IDLE | BUSY | GAMEOVER | WIN
let pieces = [];
let ice = []; // layer 0/1
let score = 0;
let best = 0;

let levelIndex = 0;
let movesLeft = 0;
let targetScore = 0;
let objectives = { collect: {}, iceLeft: 0 };

let input = { down: false, start: null, locked: false };
let lastSwap = null; // {a:{r,c}, b:{r,c}} used for bonus creation placement

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

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

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

function updateHUD(msg = "") {
  el.level.textContent = String(levelIndex + 1);
  el.score.textContent = String(score);
  el.best.textContent = String(best);
  el.moves.textContent = String(movesLeft);

  // objectives list
  el.objectives.innerHTML = "";
  const liScore = document.createElement("li");
  liScore.textContent = `Atteindre ${targetScore} points (${score}/${targetScore})`;
  el.objectives.appendChild(liScore);

  const collectKeys = Object.keys(objectives.collect || {});
  for (const k of collectKeys) {
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
  // Put ice on random cells (no duplicates)
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // board background
  ctx.fillStyle = "#0f1722";
  ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

  // grid & ice
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      ctx.strokeStyle = "rgba(232,238,246,0.07)";
      ctx.lineWidth = 1;
      ctx.strokeRect(PADDING + c * CELL, PADDING + r * CELL, CELL, CELL);

      if (ice[r][c] === 1) {
        ctx.fillStyle = "rgba(148, 163, 184, 0.18)";
        ctx.fillRect(PADDING + c * CELL, PADDING + r * CELL, CELL, CELL);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.strokeRect(PADDING + c * CELL + 6, PADDING + r * CELL + 6, CELL - 12, CELL - 12);
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
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
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
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 3;
    ctx.strokeRect(PADDING + c * CELL + 2, PADDING + r * CELL + 2, CELL - 4, CELL - 4);
  }

  // overlays
  if (state === "WIN" || state === "GAMEOVER") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);
    ctx.fillStyle = "#e8eef6";
    ctx.font = "800 28px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(state === "WIN" ? "Niveau réussi ! 🎉" : "Fin de niveau", PADDING + BOARD_SIZE / 2, PADDING + BOARD_SIZE / 2 - 10);
    ctx.font = "600 18px system-ui";
    ctx.fillText("Recommencer ou Niveau suivant", PADDING + BOARD_SIZE / 2, PADDING + BOARD_SIZE / 2 + 24);
  }
}

/** Returns groups of matched cells.
 * group = { cells:[{r,c}...], type, shape:"line"|"tl", orientation:"h"|"v"|null }
 */
function findMatchGroups() {
  const used = new Set();
  const groups = [];

  // helper to collect a run horizontally
  for (let r = 0; r < GRID; r++) {
    let runType = pieces[r][0]?.type ?? null;
    let runStart = 0;
    let runLen = 1;
    for (let c = 1; c <= GRID; c++) {
      const t = (c < GRID) ? (pieces[r][c]?.type ?? null) : Symbol("end");
      if (t === runType) runLen++;
      else {
        if (runType != null && runLen >= 3) {
          const cells = [];
          for (let k = runStart; k < runStart + runLen; k++) cells.push({ r, c: k });
          groups.push({ cells, type: runType, axis: "h" });
        }
        runType = (c < GRID) ? (pieces[r][c]?.type ?? null) : null;
        runStart = c;
        runLen = 1;
      }
    }
  }

  // vertical runs
  for (let c = 0; c < GRID; c++) {
    let runType = pieces[0][c]?.type ?? null;
    let runStart = 0;
    let runLen = 1;
    for (let r = 1; r <= GRID; r++) {
      const t = (r < GRID) ? (pieces[r][c]?.type ?? null) : Symbol("end");
      if (t === runType) runLen++;
      else {
        if (runType != null && runLen >= 3) {
          const cells = [];
          for (let k = runStart; k < runStart + runLen; k++) cells.push({ r: k, c });
          groups.push({ cells, type: runType, axis: "v" });
        }
        runType = (r < GRID) ? (pieces[r][c]?.type ?? null) : null;
        runStart = r;
        runLen = 1;
      }
    }
  }

  // Merge overlaps into larger "combo group" (to detect T/L)
  // Simple union-find-ish via iterative merge on cell overlap.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].type !== groups[j].type) continue;
        const setA = new Set(groups[i].cells.map(c => keyOf(c.r, c.c)));
        const overlap = groups[j].cells.some(c => setA.has(keyOf(c.r, c.c)));
        if (overlap) {
          // merge j into i
          const map = new Map();
          for (const c of groups[i].cells) map.set(keyOf(c.r, c.c), c);
          for (const c of groups[j].cells) map.set(keyOf(c.r, c.c), c);
          groups[i].cells = Array.from(map.values());
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // Deduplicate groups that are identical (rare)
  const uniq = [];
  const seen = new Set();
  for (const g of groups) {
    const keys = g.cells.map(c => keyOf(c.r, c.c)).sort().join("|");
    if (seen.has(keys)) continue;
    seen.add(keys);
    uniq.push(g);
  }

  // mark shape
  for (const g of uniq) {
    // Count distinct rows/cols
    const rows = new Set(g.cells.map(c => c.r));
    const cols = new Set(g.cells.map(c => c.c));
    const isLine = (rows.size === 1) || (cols.size === 1);
    g.shape = isLine ? "line" : "tl";
    g.orientation = (rows.size === 1) ? "h" : ((cols.size === 1) ? "v" : null);
  }

  return uniq;
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

function applyGravityAndRefillAnimated() {
  let maxMs = 0;
  for (let c = 0; c < GRID; c++) {
    const col = [];
    for (let r = GRID - 1; r >= 0; r--) {
      const p = pieces[r][c];
      if (p && p.active) col.push(p);
    }

    // refill from above
    while (col.length < GRID) {
      const spawnIndex = col.length;
      const newR = -1 - spawnIndex;
      const t = randType();
      const p = makePiece(newR, c, t, null);
      // start above
      const { x } = xyFromCell(0, c);
      p.x = x;
      p.y = PADDING + (newR * CELL) + CELL / 2;
      col.push(p);
    }

    for (let r = GRID - 1; r >= 0; r--) {
      const p = col[GRID - 1 - r];
      pieces[r][c] = p;

      setPieceCell(p, r, c);
      startMoveAnim(p, CFG.fallMs);
      maxMs = Math.max(maxMs, CFG.fallMs);
    }
  }
  return maxMs;
}

function decIceIfAny(r, c) {
  if (ice[r][c] === 1) {
    ice[r][c] = 0;
    objectives.iceLeft = Math.max(0, objectives.iceLeft - 1);
  }
}

function applyCollect(type, count) {
  if (objectives.collect[type] != null) {
    objectives.collect[type] = Math.max(0, objectives.collect[type] - count);
  }
}

function objectivesDone() {
  if (score < targetScore) return false;
  if (objectives.iceLeft > 0) return false;
  for (const k of Object.keys(objectives.collect)) {
    if (objectives.collect[k] > 0) return false;
  }
  return true;
}

function setEndState() {
  if (objectivesDone()) {
    state = "WIN";
    updateHUD("Objectifs remplis ✅");
  } else if (movesLeft <= 0) {
    state = "GAMEOVER";
    updateHUD("Plus de coups… 😬");
  } else {
    updateHUD("");
  }
}

function triggerSpecialAt(r, c, extraClears) {
  const p = pieces[r][c];
  if (!p || !p.special) return;

  if (p.special === "row") {
    for (let cc = 0; cc < GRID; cc++) extraClears.add(keyOf(r, cc));
  } else if (p.special === "col") {
    for (let rr = 0; rr < GRID; rr++) extraClears.add(keyOf(rr, c));
  } else if (p.special === "bomb") {
    for (let rr = r - 1; rr <= r + 1; rr++) {
      for (let cc = c - 1; cc <= c + 1; cc++) {
        if (inBounds(rr, cc)) extraClears.add(keyOf(rr, cc));
      }
    }
  } else if (p.special === "color") {
    // clear all of some target color:
    // If lastSwap exists and we swapped with a normal piece, use that color; else use random.
    let target = null;
    if (lastSwap) {
      const a = lastSwap.a, b = lastSwap.b;
      const other = (a.r === r && a.c === c) ? pieces[b.r][b.c] : pieces[a.r][a.c];
      if (other && other.type != null) target = other.type;
    }
    if (target == null) target = randType();

    for (let rr = 0; rr < GRID; rr++) {
      for (let cc = 0; cc < GRID; cc++) {
        const q = pieces[rr][cc];
        if (q && q.type === target) extraClears.add(keyOf(rr, cc));
      }
    }
  }
}

function createBonusFromGroup(group, anchorCell) {
  // group: cells + shape + orientation + type
  const size = group.cells.length;

  // Decide bonus type
  let bonus = null;
  if (group.shape === "tl") {
    bonus = "bomb";
  } else if (size >= 5) {
    bonus = "color";
  } else if (size === 4) {
    // line bonus depends on orientation
    bonus = (group.orientation === "h") ? "row" : "col";
  }

  if (!bonus) return null;

  // Anchor: prefer a swapped cell inside the group (feels natural)
  let place = null;
  if (lastSwap) {
    const a = lastSwap.a, b = lastSwap.b;
    const set = new Set(group.cells.map(c => keyOf(c.r, c.c)));
    if (set.has(keyOf(a.r, a.c))) place = { r: a.r, c: a.c };
    else if (set.has(keyOf(b.r, b.c))) place = { r: b.r, c: b.c };
  }
  if (!place && anchorCell) place = anchorCell;
  if (!place) place = group.cells[Math.floor(group.cells.length / 2)];

  // Create bonus piece at place: it must SURVIVE, so we remove other cells but keep this one.
  const p = pieces[place.r][place.c];
  if (!p) return null;
  p.special = bonus;
  return place; // cell that should NOT be cleared
}

function resolveChain() {
  state = "BUSY";
  input.locked = true;

  const step = () => {
    // 1) find groups
    const groups = findMatchGroups();
    if (groups.length === 0) {
      state = "IDLE";
      input.locked = false;

      if (score > best) best = score;
      saveGame();
      setEndState();
      return;
    }

    // 2) build clear set
    const clear = new Set();
    const keep = new Set(); // cells to keep because they become bonuses

    // create bonuses first (so we can keep their cells)
    for (const g of groups) {
      // anchor: none (we handle via lastSwap preference)
      const keptCell = createBonusFromGroup(g, null);
      if (keptCell) keep.add(keyOf(keptCell.r, keptCell.c));
    }

    // add group cells to clear (except kept bonus cell)
    for (const g of groups) {
      for (const c of g.cells) {
        const k = keyOf(c.r, c.c);
        if (!keep.has(k)) clear.add(k);
      }
    }

    // 3) specials chain reaction: if a special is in the clear set, expand clear
    let expanded = true;
    while (expanded) {
      expanded = false;
      const extra = new Set();
      for (const k of clear) {
        const [r, c] = k.split(",").map(Number);
        const p = pieces[r][c];
        if (p && p.special) {
          triggerSpecialAt(r, c, extra);
        }
      }
      for (const k of extra) {
        if (!clear.has(k) && !keep.has(k)) {
          clear.add(k);
          expanded = true;
        }
      }
    }

    if (clear.size === 0) {
      // safety
      const fallMs = applyGravityAndRefillAnimated();
      setTimeout(step, fallMs + CFG.chainDelay);
      return;
    }

    // 4) apply objectives & score
    // score: 10 per piece, + bonus for chain complexity
    score += clear.size * 10 + Math.max(0, groups.length - 1) * 20;

    // collect counts by type (only non-null)
    const typeCounts = new Map();
    for (const k of clear) {
      const [r, c] = k.split(",").map(Number);
      const p = pieces[r][c];
      if (p) typeCounts.set(p.type, (typeCounts.get(p.type) || 0) + 1);
    }
    for (const [t, cnt] of typeCounts.entries()) applyCollect(String(t), cnt);

    // ice breaks when the piece in that cell is cleared
    for (const k of clear) {
      const [r, c] = k.split(",").map(Number);
      decIceIfAny(r, c);
    }

    updateHUD("");

    // 5) pop & remove
    for (const k of clear) {
      const [r, c] = k.split(",").map(Number);
      const p = pieces[r][c];
      if (p) startPop(p);
      pieces[r][c] = null;
    }

    // 6) wait pop, then gravity, then next step
    setTimeout(() => {
      const fallMs = applyGravityAndRefillAnimated();
      setTimeout(step, fallMs + CFG.chainDelay);
    }, CFG.popMs + CFG.chainDelay);
  };

  step();
}

function tryMove(from, to) {
  if (!from || !to) return;
  if (state !== "IDLE") return;
  if (movesLeft <= 0) return;
  if (!inBounds(from.r, from.c) || !inBounds(to.r, to.c)) return;

  const dr = Math.abs(from.r - to.r);
  const dc = Math.abs(from.c - to.c);
  if (dr + dc !== 1) return;

  input.locked = true;
  state = "BUSY";

  lastSwap = { a: { ...from }, b: { ...to } };

  // Special + Special: allow big combo
  const pa = pieces[from.r][from.c];
  const pb = pieces[to.r][to.c];

  swapPieces(from, to, true);

  setTimeout(() => {
    // if either is "color" and swapped with something: trigger immediately even without match
    const aNow = pieces[to.r][to.c];
    const bNow = pieces[from.r][from.c];

    const immediate = (aNow?.special === "color") || (bNow?.special === "color");
    const hasMatches = findMatchGroups().length > 0;

    if (!immediate && !hasMatches) {
      // swap back
      swapPieces(from, to, true);
      setTimeout(() => {
        state = "IDLE";
        input.locked = false;
        lastSwap = null;
      }, CFG.swapMs + 10);
      return;
    }

    // valid move
    movesLeft--;
    updateHUD("");

    // if immediate color bomb activation: clear set created now
    if (immediate) {
      // force clear via adding the color bomb cell to the board match resolution pipeline:
      // We simulate by clearing the bomb itself + all of target color.
      const clear = new Set();
      const extra = new Set();

      // find where the color bomb is
      let bombCell = null;
      if (aNow?.special === "color") bombCell = { r: to.r, c: to.c };
      if (bNow?.special === "color") bombCell = { r: from.r, c: from.c };

      if (bombCell) {
        clear.add(keyOf(bombCell.r, bombCell.c));
        triggerSpecialAt(bombCell.r, bombCell.c, extra);
      }
      for (const k of extra) clear.add(k);

      // score & objectives
      score += clear.size * 10 + 50;
      const counts = new Map();
      for (const k of clear) {
        const [r, c] = k.split(",").map(Number);
        const p = pieces[r][c];
        if (p) counts.set(p.type, (counts.get(p.type) || 0) + 1);
      }
      for (const [t, cnt] of counts.entries()) applyCollect(String(t), cnt);
      for (const k of clear) {
        const [r, c] = k.split(",").map(Number);
        decIceIfAny(r, c);
      }
      updateHUD("");

      // pop remove
      for (const k of clear) {
        const [r, c] = k.split(",").map(Number);
        const p = pieces[r][c];
        if (p) startPop(p);
        pieces[r][c] = null;
      }

      setTimeout(() => {
        const fallMs = applyGravityAndRefillAnimated();
        setTimeout(() => {
          // then normal chain resolution
          resolveChain();
        }, fallMs + CFG.chainDelay);
      }, CFG.popMs + CFG.chainDelay);

      return;
    }

    // normal resolve
    resolveChain();
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
  if (input.locked) return;
  if (state === "WIN" || state === "GAMEOVER") return;
  e.preventDefault();
  const { x, y } = canvasPosFromEvent(e);
  const cell = cellFromXY(x, y);
  if (!cell) return;
  input.down = true;
  input.start = { ...cell, x, y };
}

function onPointerMove(e) {
  if (!input.down || input.locked || !input.start) return;
  if (state !== "IDLE") return;
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
    input.down = false; input.start = null; return;
  }

  const from = { r: input.start.r, c: input.start.c };
  input.down = false;
  input.start = null;

  tryMove(from, target);
}

function onPointerUp() { input.down = false; input.start = null; }

function applyLevel(index, fresh = true) {
  levelIndex = clamp(index, 0, LEVELS.length - 1);
  const L = LEVELS[levelIndex];

  movesLeft = L.moves;
  targetScore = L.targetScore;
  score = fresh ? 0 : score;

  objectives = {
    collect: { ...(L.collect || {}) },
    iceLeft: Number(L.ice || 0),
  };

  buildNewBoardNoMatches();
  placeIce(objectives.iceLeft);

  state = "IDLE";
  input.locked = false;
  lastSwap = null;

  updateHUD(`Niveau ${levelIndex + 1} : bonne chance 👀`);
  saveGame();
}

function newGame() {
  const s = loadSave();
  best = Number(s?.best ?? 0);
  applyLevel(levelIndex, true);
}

function nextLevel() {
  if (levelIndex < LEVELS.length - 1) {
    applyLevel(levelIndex + 1, true);
  } else {
    updateHUD("Tu as fini la démo de niveaux ✅ (ajoute-en dans LEVELS)");
    state = "WIN";
  }
}

function maybeResume() {
  const s = loadSave();
  if (!s || !s.grid) {
    best = 0;
    applyLevel(0, true);
    return;
  }

  best = Number(s.best ?? 0);
  levelIndex = clamp(Number(s.levelIndex ?? 0), 0, LEVELS.length - 1);
  score = Number(s.score ?? 0);
  movesLeft = Number(s.movesLeft ?? LEVELS[levelIndex].moves);
  targetScore = Number(s.targetScore ?? LEVELS[levelIndex].targetScore);
  objectives = s.objectives ?? { collect: {}, iceLeft: 0 };

  // rebuild grid
  pieces = Array.from({ length: GRID }, (_, r) =>
    Array.from({ length: GRID }, (_, c) => {
      const cell = s.grid?.[r]?.[c];
      return cell ? makePiece(r, c, cell.t, cell.s ?? null) : null;
    })
  );
  ice = s.ice ?? Array.from({ length: GRID }, () => Array(GRID).fill(0));

  state = "IDLE";
  input.locked = false;
  lastSwap = null;

  updateHUD("Reprise de la partie sauvegardée");
  setEndState();
}

function tick() {
  draw();
  requestAnimationFrame(tick);
}

canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
canvas.addEventListener("pointermove", onPointerMove, { passive: false });
canvas.addEventListener("pointerup", onPointerUp, { passive: true });
canvas.addEventListener("pointercancel", onPointerUp, { passive: true });

el.newGame?.addEventListener("click", () => applyLevel(levelIndex, true));
el.nextLevel?.addEventListener("click", nextLevel);

maybeResume();
tick();