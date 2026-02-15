/* Match-3 minimal (Canvas) - mobile friendly */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const newGameBtn = document.getElementById("newGame");

const GRID = 8;
const TYPES = 6; // nombre de couleurs
const PADDING = 18;
const BOARD_SIZE = canvas.width - PADDING * 2;
const CELL = BOARD_SIZE / GRID;

const COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#14b8a6", // teal
];

let board = [];
let score = 0;

let input = {
  down: false,
  start: null,  // {r,c,x,y}
  current: null,
  locked: false, // bloque pendant résolution
};

function randType() {
  return Math.floor(Math.random() * TYPES);
}

function inBounds(r, c) {
  return r >= 0 && r < GRID && c >= 0 && c < GRID;
}

function makeEmptyBoard() {
  board = Array.from({ length: GRID }, () => Array(GRID).fill(0));
}

function wouldMakeMatchAt(r, c, t) {
  // check horizontal 3
  let left1 = inBounds(r, c - 1) && board[r][c - 1] === t;
  let left2 = inBounds(r, c - 2) && board[r][c - 2] === t;
  let right1 = inBounds(r, c + 1) && board[r][c + 1] === t;
  let right2 = inBounds(r, c + 2) && board[r][c + 2] === t;

  if ((left1 && left2) || (right1 && right2) || (left1 && right1)) return true;

  // check vertical 3
  let up1 = inBounds(r - 1, c) && board[r - 1][c] === t;
  let up2 = inBounds(r - 2, c) && board[r - 2][c] === t;
  let down1 = inBounds(r + 1, c) && board[r + 1][c] === t;
  let down2 = inBounds(r + 2, c) && board[r + 2][c] === t;

  if ((up1 && up2) || (down1 && down2) || (up1 && down1)) return true;

  return false;
}

function fillBoardNoMatches() {
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      let t;
      let guard = 0;
      do {
        t = randType();
        guard++;
        // évite boucle infinie (théoriquement impossible ici)
        if (guard > 50) break;
      } while (wouldMakeMatchAt(r, c, t));
      board[r][c] = t;
    }
  }
}

function cellFromXY(x, y) {
  const bx = (x - PADDING);
  const by = (y - PADDING);
  const c = Math.floor(bx / CELL);
  const r = Math.floor(by / CELL);
  if (!inBounds(r, c)) return null;
  return { r, c };
}

function xyFromCell(r, c) {
  const x = PADDING + c * CELL + CELL / 2;
  const y = PADDING + r * CELL + CELL / 2;
  return { x, y };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // board background
  ctx.fillStyle = "#0f1722";
  ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

  // grid + pieces
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const { x, y } = xyFromCell(r, c);

      // cell outline
      ctx.strokeStyle = "rgba(232,238,246,0.07)";
      ctx.lineWidth = 1;
      ctx.strokeRect(PADDING + c * CELL, PADDING + r * CELL, CELL, CELL);

      const t = board[r][c];
      if (t == null) continue;

      // piece
      ctx.beginPath();
      ctx.fillStyle = COLORS[t];
      const radius = CELL * 0.33;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // shine
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.fillStyle = "#ffffff";
      ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
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
}

function findMatches() {
  // returns Set of "r,c" to clear
  const clear = new Set();

  // horizontal
  for (let r = 0; r < GRID; r++) {
    let runType = board[r][0];
    let runStart = 0;
    let runLen = 1;

    for (let c = 1; c <= GRID; c++) {
      const t = (c < GRID) ? board[r][c] : Symbol("end");
      if (t === runType) {
        runLen++;
      } else {
        if (runType != null && runLen >= 3) {
          for (let k = runStart; k < runStart + runLen; k++) clear.add(`${r},${k}`);
        }
        runType = (c < GRID) ? board[r][c] : null;
        runStart = c;
        runLen = 1;
      }
    }
  }

  // vertical
  for (let c = 0; c < GRID; c++) {
    let runType = board[0][c];
    let runStart = 0;
    let runLen = 1;

    for (let r = 1; r <= GRID; r++) {
      const t = (r < GRID) ? board[r][c] : Symbol("end");
      if (t === runType) {
        runLen++;
      } else {
        if (runType != null && runLen >= 3) {
          for (let k = runStart; k < runStart + runLen; k++) clear.add(`${k},${c}`);
        }
        runType = (r < GRID) ? board[r][c] : null;
        runStart = r;
        runLen = 1;
      }
    }
  }

  return clear;
}

function swapCells(a, b) {
  const tmp = board[a.r][a.c];
  board[a.r][a.c] = board[b.r][b.c];
  board[b.r][b.c] = tmp;
}

function applyGravityAndRefill() {
  // gravity per column
  for (let c = 0; c < GRID; c++) {
    const col = [];
    for (let r = GRID - 1; r >= 0; r--) {
      const t = board[r][c];
      if (t != null) col.push(t);
    }
    // refill
    while (col.length < GRID) col.push(randType());

    // write back
    for (let r = GRID - 1; r >= 0; r--) {
      board[r][c] = col[GRID - 1 - r];
    }
  }
}

function resolveBoard() {
  // chain reactions
  let totalCleared = 0;
  while (true) {
    const clear = findMatches();
    if (clear.size === 0) break;

    totalCleared += clear.size;

    // clear
    for (const key of clear) {
      const [r, c] = key.split(",").map(Number);
      board[r][c] = null;
    }

    // score (simple)
    score += clear.size * 10;
    scoreEl.textContent = String(score);

    applyGravityAndRefill();
  }

  return totalCleared;
}

function tryMove(from, to) {
  if (!from || !to) return;
  const dr = Math.abs(from.r - to.r);
  const dc = Math.abs(from.c - to.c);
  if (dr + dc !== 1) return; // must be adjacent

  swapCells(from, to);
  const cleared = findMatches().size;
  if (cleared === 0) {
    // invalid move: swap back
    swapCells(from, to);
    return;
  }
  // valid: resolve fully
  resolveBoard();
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
  e.preventDefault();
  const { x, y } = canvasPosFromEvent(e);
  const cell = cellFromXY(x, y);
  if (!cell) return;
  input.down = true;
  input.start = { ...cell, x, y };
  input.current = { x, y };
}

function onPointerMove(e) {
  if (!input.down || input.locked || !input.start) return;
  e.preventDefault();
  const { x, y } = canvasPosFromEvent(e);
  input.current = { x, y };

  // detect swipe direction once it crosses threshold
  const dx = x - input.start.x;
  const dy = y - input.start.y;
  const threshold = CELL * 0.25;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

  let target = { r: input.start.r, c: input.start.c };
  if (Math.abs(dx) > Math.abs(dy)) {
    target.c += (dx > 0) ? 1 : -1;
  } else {
    target.r += (dy > 0) ? 1 : -1;
  }

  if (!inBounds(target.r, target.c)) {
    input.down = false;
    input.start = null;
    return;
  }

  input.locked = true;
  tryMove({ r: input.start.r, c: input.start.c }, target);

  // unlock quickly (animations futures -> augmenter)
  setTimeout(() => {
    input.locked = false;
    input.down = false;
    input.start = null;
  }, 60);
}

function onPointerUp(e) {
  if (input.locked) return;
  input.down = false;
  input.start = null;
}

function newGame() {
  score = 0;
  scoreEl.textContent = "0";
  makeEmptyBoard();
  fillBoardNoMatches();
  // au cas où : résout si jamais un match “passe”
  resolveBoard();
  draw();
}

// loop
function tick() {
  draw();
  requestAnimationFrame(tick);
}

canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
canvas.addEventListener("pointermove", onPointerMove, { passive: false });
canvas.addEventListener("pointerup", onPointerUp, { passive: true });
canvas.addEventListener("pointercancel", onPointerUp, { passive: true });

newGameBtn.addEventListener("click", newGame);

newGame();
tick();
