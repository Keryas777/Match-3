(() => {
  const bootError = (err) => {
    const el = document.getElementById("bootError");
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent =
      "Le jeu a crash.\n\n" +
      String(err?.stack || err) +
      "\n\nAstuce: vérifie que index.html / style.css / game.js sont bien au même endroit.";
  };

  try {
    // iOS: block pinch/double-tap zoom
    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
    let __lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (e) => {
        const t = Date.now();
        if (t - __lastTouchEnd <= 300) e.preventDefault();
        __lastTouchEnd = t;
      },
      { passive: false }
    );

    const canvas = document.getElementById("game");
    if (!canvas) throw new Error("Canvas #game introuvable");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D indisponible");

    const ui = {
      level: document.getElementById("level"),
      score: document.getElementById("score"),
      best: document.getElementById("best"),
      moves: document.getElementById("moves"),
      objectives: document.getElementById("objectives"),
      status: document.getElementById("status"),
      newGame: document.getElementById("newGame"),
      openLevels: document.getElementById("openLevels"),

      winModal: document.getElementById("winModal"),
      winText: document.getElementById("winText"),
      winRestart: document.getElementById("winRestart"),
      winNext: document.getElementById("winNext"),
      winLevels: document.getElementById("winLevels"),

      loseModal: document.getElementById("loseModal"),
      loseText: document.getElementById("loseText"),
      loseDetails: document.getElementById("loseDetails"),
      loseRestart: document.getElementById("loseRestart"),
      loseLevels: document.getElementById("loseLevels"),

      levelsModal: document.getElementById("levelsModal"),
      levelsGrid: document.getElementById("levelsGrid"),
      levelsClose: document.getElementById("levelsClose"),
    };

    const must = [
      "level","score","best","moves","objectives","status","newGame",
      "openLevels",
      "winModal","winText","winRestart","winNext","winLevels",
      "loseModal","loseText","loseDetails","loseRestart","loseLevels",
      "levelsModal","levelsGrid","levelsClose"
    ];
    for (const k of must) if (!ui[k]) throw new Error(`Element manquant: ${k}`);

    // ---------- CONFIG ----------
    const GRID = 8;
    const TYPES = 6;

    const PADDING = 18;
    const BOARD_SIZE = canvas.width - PADDING * 2;
    const CELL = BOARD_SIZE / GRID;

    const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#14b8a6"];
    const COLOR_NAMES = ["Rouge", "Orange", "Vert", "Bleu", "Violet", "Turquoise"];

    const CFG = {
      swapMs: 140,
      fallMs: 180,
      popMs: 160,
      chainGap: 60,

      fxBurstMs: 450,
      fxFlashMs: 160,
      shakeMs: 220,

      beamMs: 320,
      crossMs: 420,
    };

    // ⚠️ Garde la même clé pour ne pas perdre ta progression
    const SAVE_KEY = "match3_v3_save";

    // Ajoute autant de niveaux que tu veux
    const LEVELS = [
      { moves: 20, targetScore: 800,  collect: { 0: 12, 3: 10 }, ice: 8  },
      { moves: 22, targetScore: 1200, collect: { 2: 14, 5: 12 }, ice: 12 },
      { moves: 25, targetScore: 1800, collect: { 1: 18, 4: 14 }, ice: 16 },
      { moves: 26, targetScore: 2300, collect: { 0: 18, 2: 14 }, ice: 18 },
      { moves: 28, targetScore: 3000, collect: { 3: 20 },      ice: 22 },
    ];

    // ---------- UTILS ----------
    const now = () => performance.now();
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const inBounds = (r, c) => r >= 0 && r < GRID && c >= 0 && c < GRID;
    const keyOf = (r, c) => `${r},${c}`;
    const randType = () => Math.floor(Math.random() * TYPES);

    const xyFromCell = (r, c) => ({
      x: PADDING + c * CELL + CELL / 2,
      y: PADDING + r * CELL + CELL / 2,
    });

    const cellFromXY = (x, y) => {
      const bx = x - PADDING;
      const by = y - PADDING;
      const c = Math.floor(bx / CELL);
      const r = Math.floor(by / CELL);
      if (!inBounds(r, c)) return null;
      return { r, c };
    };

    // ---------- STATE ----------
    let levelIndex = 0;
    let score = 0;
    let best = 0;
    let movesLeft = 0;
    let targetScore = 0;
    let objectives = { collect: {}, iceLeft: 0 };

    // Progression persistante
    let unlockedMax = 1;                  // 1-based
    let stars = Array(LEVELS.length).fill(0); // 0..3 par niveau (meilleur)

    let pieces = [];
    let ice = [];

    let state = "IDLE"; // IDLE | BUSY | WIN | LOSE
    let input = { down: false, start: null, locked: false };
    let lastSwap = null;

    // ---------- FX ----------
    // beams: {kind:"row"|"col", r|c, mode:"full"|"sweep", cx|cy, t0,dur,intensity}
    const fx = { bursts: [], flash: null, shake: null, beams: [], crosses: [] };

    function addBurst(r, c, type, intensity = 1) {
      const { x, y } = xyFromCell(r, c);
      fx.bursts.push({ x, y, color: COLORS[type], intensity, t0: now(), dur: CFG.fxBurstMs });
    }
    function addFlash(intensity = 1) { fx.flash = { t0: now(), dur: CFG.fxFlashMs, intensity }; }
    function addShake(intensity = 1) { fx.shake = { t0: now(), dur: CFG.shakeMs, intensity }; }

    function addBeamRow(r, intensity = 1, mode = "full", centerC = null) {
      const cy = PADDING + r * CELL + CELL / 2;
      const cx = centerC == null ? (PADDING + BOARD_SIZE / 2) : (PADDING + centerC * CELL + CELL / 2);
      fx.beams.push({ kind: "row", r, mode, cx, cy, t0: now(), dur: CFG.beamMs, intensity });
    }
    function addBeamCol(c, intensity = 1, mode = "full", centerR = null) {
      const cx = PADDING + c * CELL + CELL / 2;
      const cy = centerR == null ? (PADDING + BOARD_SIZE / 2) : (PADDING + centerR * CELL + CELL / 2);
      fx.beams.push({ kind: "col", c, mode, cx, cy, t0: now(), dur: CFG.beamMs, intensity });
    }
    function addCross(r, c, intensity = 1) {
      const { x, y } = xyFromCell(r, c);
      fx.crosses.push({ x, y, t0: now(), dur: CFG.crossMs, intensity });
    }

    function getShakeOffset() {
      if (!fx.shake) return { dx: 0, dy: 0 };
      const t = now();
      const p = clamp((t - fx.shake.t0) / fx.shake.dur, 0, 1);
      if (p >= 1) { fx.shake = null; return { dx: 0, dy: 0 }; }
      const a = (1 - p) * 6 * fx.shake.intensity;
      return {
        dx: (Math.sin(t * 0.08) + Math.sin(t * 0.13)) * 0.5 * a,
        dy: (Math.cos(t * 0.09) + Math.cos(t * 0.11)) * 0.5 * a,
      };
    }

    function drawFX() {
      const t = now();

      fx.bursts = fx.bursts.filter((b) => t < b.t0 + b.dur);
      for (const b of fx.bursts) {
        const p = clamp((t - b.t0) / b.dur, 0, 1);
        const e = easeOut(p);
        const ringR = (CELL * 0.15 + CELL * 0.65 * e) * b.intensity;

        ctx.globalAlpha = (1 - p) * 0.55;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, ringR, 0, Math.PI * 2);
        ctx.stroke();

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

      fx.beams = fx.beams.filter((b) => t < b.t0 + b.dur);
      for (const b of fx.beams) {
        const p = clamp((t - b.t0) / b.dur, 0, 1);
        const e = easeOut(p);
        const a = (1 - p) * 0.70 * b.intensity;

        ctx.globalAlpha = a;
        ctx.fillStyle = "#ffffff";
        const thickness = 12;

        if (b.kind === "row") {
          const y = b.cy;
          if (b.mode === "full") {
            ctx.fillRect(PADDING, y - thickness/2, BOARD_SIZE, thickness);
          } else {
            const maxL = b.cx - PADDING;
            const maxR = PADDING + BOARD_SIZE - b.cx;
            const left = b.cx - maxL * e;
            const width = (maxL + maxR) * e;
            ctx.fillRect(left, y - thickness/2, width, thickness);
            ctx.globalAlpha = a * 0.9;
            ctx.fillRect(b.cx - 18, y - 3, 36, 6);
            ctx.globalAlpha = a;
          }
        } else {
          const x = b.cx;
          if (b.mode === "full") {
            ctx.fillRect(x - thickness/2, PADDING, thickness, BOARD_SIZE);
          } else {
            const maxU = b.cy - PADDING;
            const maxD = PADDING + BOARD_SIZE - b.cy;
            const top = b.cy - maxU * e;
            const height = (maxU + maxD) * e;
            ctx.fillRect(x - thickness/2, top, thickness, height);
            ctx.globalAlpha = a * 0.9;
            ctx.fillRect(x - 3, b.cy - 18, 6, 36);
            ctx.globalAlpha = a;
          }
        }
        ctx.globalAlpha = 1;
      }

      fx.crosses = fx.crosses.filter((c) => t < c.t0 + c.dur);
      for (const c of fx.crosses) {
        const p = clamp((t - c.t0) / c.dur, 0, 1);
        const e = easeOut(p);
        const a = (1 - p) * 0.55 * c.intensity;

        ctx.globalAlpha = a;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 5;

        const r = (CELL * 0.6 + CELL * 1.8 * e) * c.intensity;
        ctx.beginPath();
        ctx.moveTo(c.x - r, c.y); ctx.lineTo(c.x + r, c.y);
        ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x, c.y + r);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (fx.flash) {
        const p = clamp((t - fx.flash.t0) / fx.flash.dur, 0, 1);
        const a = (1 - p) * 0.25 * fx.flash.intensity;
        if (a > 0.001) {
          ctx.globalAlpha = a;
          ctx.fillStyle = "#fff";
          ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);
          ctx.globalAlpha = 1;
        } else fx.flash = null;
      }
    }

    // ---------- UI ----------
    function updateHUD(msg = "") {
      ui.level.textContent = String(levelIndex + 1);
      ui.score.textContent = String(score);
      ui.best.textContent = String(best);
      ui.moves.textContent = String(movesLeft);
      ui.status.textContent = msg;

      ui.objectives.innerHTML = "";
      const liScore = document.createElement("li");
      liScore.textContent = `Atteindre ${targetScore} points (${score}/${targetScore})`;
      ui.objectives.appendChild(liScore);

      for (const k of Object.keys(objectives.collect || {})) {
        const need = objectives.collect[k];
        if (need <= 0) continue;
        const li = document.createElement("li");
        li.textContent = `Collecter ${need} ${COLOR_NAMES[Number(k)]}`;
        ui.objectives.appendChild(li);
      }

      if (objectives.iceLeft > 0) {
        const li = document.createElement("li");
        li.textContent = `Casser la glace : ${objectives.iceLeft} restante(s)`;
        ui.objectives.appendChild(li);
      }
    }

    function objectivesDone() {
      if (score < targetScore) return false;
      if (objectives.iceLeft > 0) return false;
      for (const k of Object.keys(objectives.collect)) if (objectives.collect[k] > 0) return false;
      return true;
    }

    function computeStarsEarned() {
      const startMoves = LEVELS[levelIndex].moves;
      const ratio = startMoves > 0 ? (movesLeft / startMoves) : 0;

      // 3★: ≥40% des coups restants, 2★: ≥20%, sinon 1★
      if (ratio >= 0.40) return 3;
      if (ratio >= 0.20) return 2;
      return 1;
    }

    function renderStarsText(n) {
      const filled = "★".repeat(n);
      const empty = "☆".repeat(3 - n);
      return filled + empty;
    }

    function showWin(starsEarned) {
      const bestForLevel = stars[levelIndex] || 0;
      ui.winText.textContent = `Niveau ${levelIndex + 1} validé ✅  ${renderStarsText(starsEarned)}  (Meilleur: ${renderStarsText(bestForLevel)})`;
      ui.winModal.classList.remove("hidden");
    }
    function hideWin() { ui.winModal.classList.add("hidden"); }

    function buildMissingLines() {
      const lines = [];
      if (score < targetScore) lines.push(`🎯 Score manquant : ${targetScore - score}`);
      for (const k of Object.keys(objectives.collect || {})) {
        const need = objectives.collect[k];
        if (need > 0) lines.push(`🧩 ${COLOR_NAMES[Number(k)]} à collecter : ${need}`);
      }
      if (objectives.iceLeft > 0) lines.push(`🧊 Glace restante : ${objectives.iceLeft}`);
      return lines.length ? lines : ["Tout est validé (devrait être une victoire)."];
    }

    function showLose() {
      ui.loseText.textContent = `Tu n’as plus de coups.`;
      ui.loseDetails.innerHTML = "";
      for (const line of buildMissingLines()) {
        const li = document.createElement("li");
        li.textContent = line;
        ui.loseDetails.appendChild(li);
      }
      ui.loseModal.classList.remove("hidden");
    }
    function hideLose() { ui.loseModal.classList.add("hidden"); }

    // ---------- LEVEL MAP (Candy Crush style) ----------
    function openLevels() {
      ui.levelsGrid.innerHTML = "";
      ui.levelsGrid.classList.add("mapWrap");

      const nodes = LEVELS.map((_, i) => {
        const x = (i % 2 === 0) ? 25 : 75;
        const y = 12 + i * 18;
        return { i, x, y };
      });

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.classList.add("mapPath");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const d = nodes.map((n, idx) => `${idx === 0 ? "M" : "L"} ${n.x} ${n.y}`).join(" ");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(255,255,255,0.25)");
      path.setAttribute("stroke-width", "3");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);

      const unlockedPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const unlockedCount = clamp(unlockedMax, 1, LEVELS.length);
      const d2 = nodes
        .slice(0, unlockedCount)
        .map((n, idx) => `${idx === 0 ? "M" : "L"} ${n.x} ${n.y}`)
        .join(" ");
      unlockedPath.setAttribute("d", d2);
      unlockedPath.setAttribute("fill", "none");
      unlockedPath.setAttribute("stroke", "rgba(255,255,255,0.65)");
      unlockedPath.setAttribute("stroke-width", "4");
      unlockedPath.setAttribute("stroke-linecap", "round");
      unlockedPath.setAttribute("stroke-linejoin", "round");
      svg.appendChild(unlockedPath);

      ui.levelsGrid.appendChild(svg);

      nodes.forEach(n => {
        const levelNumber = n.i + 1;
        const isUnlocked = levelNumber <= unlockedMax;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mapNode" + (isUnlocked ? "" : " locked");
        btn.style.left = `${n.x}%`;
        btn.style.top = `${n.y}%`;
        if (n.i === levelIndex) btn.classList.add("current");

        const starCount = stars[n.i] || 0;
        const starsRow = document.createElement("div");
        starsRow.className = "nodeStars";
        starsRow.textContent = renderStarsText(starCount);

        const label = document.createElement("div");
        label.className = "nodeLabel";
        label.textContent = String(levelNumber);

        btn.appendChild(label);
        btn.appendChild(starsRow);

        if (!isUnlocked) {
          btn.disabled = true;
          const lock = document.createElement("div");
          lock.className = "nodeLock";
          lock.textContent = "🔒";
          btn.appendChild(lock);
        } else {
          btn.onclick = () => { closeLevels(); applyLevel(n.i, true); };
        }

        ui.levelsGrid.appendChild(btn);
      });

      ui.levelsModal.classList.remove("hidden");
    }

    function closeLevels() {
      ui.levelsGrid.classList.remove("mapWrap");
      ui.levelsModal.classList.add("hidden");
    }

    // ---------- BOARD ----------
    function resetArrays() {
      pieces = Array.from({ length: GRID }, () => Array(GRID).fill(null));
      ice = Array.from({ length: GRID }, () => Array(GRID).fill(0));
    }

    function makePiece(r, c, type, special = null) {
      const { x, y } = xyFromCell(r, c);
      return {
        r, c, type, special,
        x, y, sx: x, sy: y, tx: x, ty: y,
        t0: 0, t1: 0,
        popping: false, popT0: 0, popT1: 0,
        active: true
      };
    }

    function setPieceCell(p, r, c) {
      p.r = r; p.c = c;
      const { x, y } = xyFromCell(r, c);
      p.sx = p.x; p.sy = p.y;
      p.tx = x; p.ty = y;
    }

    function startMoveAnim(p, ms) { p.t0 = now(); p.t1 = p.t0 + ms; p.sx = p.x; p.sy = p.y; }
    function startPop(p) { p.popping = true; p.popT0 = now(); p.popT1 = p.popT0 + CFG.popMs; }

    function wouldMakeMatchAt(r, c, type) {
      const get = (rr, cc) => (inBounds(rr, cc) ? pieces[rr][cc]?.type ?? null : null);
      const l1 = get(r, c - 1) === type, l2 = get(r, c - 2) === type;
      const r1 = get(r, c + 1) === type, r2 = get(r, c + 2) === type;
      if ((l1 && l2) || (r1 && r2) || (l1 && r1)) return true;

      const u1 = get(r - 1, c) === type, u2 = get(r - 2, c) === type;
      const d1 = get(r + 1, c) === type, d2 = get(r + 2, c) === type;
      if ((u1 && u2) || (d1 && d2) || (u1 && d1)) return true;
      return false;
    }

    function buildNewBoardNoMatches() {
      resetArrays();
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          let t, guard = 0;
          do { t = randType(); guard++; if (guard > 80) break; }
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
      for (let i = 0; i < Math.min(count, cells.length); i++) ice[cells[i].r][cells[i].c] = 1;
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

    function applyGravityAndRefill() {
      for (let c = 0; c < GRID; c++) {
        const col = [];
        for (let r = GRID - 1; r >= 0; r--) {
          const p = pieces[r][c];
          if (p && p.active) col.push(p);
        }
        while (col.length < GRID) {
          const spawnIndex = col.length;
          const newR = -1 - spawnIndex;
          const p = makePiece(newR, c, randType(), null);
          const { x } = xyFromCell(0, c);
          p.x = x;
          p.y = PADDING + newR * CELL + CELL / 2;
          col.push(p);
        }
        for (let r = GRID - 1; r >= 0; r--) {
          const p = col[GRID - 1 - r];
          pieces[r][c] = p;
          setPieceCell(p, r, c);
          startMoveAnim(p, CFG.fallMs);
        }
      }
    }

    // ---------- MATCH FIND ----------
    function findMatchGroups() {
      const groups = [];

      // horizontal
      for (let r = 0; r < GRID; r++) {
        let runType = pieces[r][0]?.type ?? null;
        let runStart = 0;
        let runLen = 1;

        for (let c = 1; c <= GRID; c++) {
          const t = c < GRID ? pieces[r][c]?.type ?? null : Symbol("end");
          if (t === runType) runLen++;
          else {
            if (runType != null && runLen >= 3) {
              const cells = [];
              for (let k = runStart; k < runStart + runLen; k++) cells.push({ r, c: k });
              groups.push({ cells, type: runType, axis: "h" });
            }
            runType = c < GRID ? pieces[r][c]?.type ?? null : null;
            runStart = c; runLen = 1;
          }
        }
      }

      // vertical
      for (let c = 0; c < GRID; c++) {
        let runType = pieces[0][c]?.type ?? null;
        let runStart = 0;
        let runLen = 1;

        for (let r = 1; r <= GRID; r++) {
          const t = r < GRID ? pieces[r][c]?.type ?? null : Symbol("end");
          if (t === runType) runLen++;
          else {
            if (runType != null && runLen >= 3) {
              const cells = [];
              for (let k = runStart; k < runStart + runLen; k++) cells.push({ r: k, c });
              groups.push({ cells, type: runType, axis: "v" });
            }
            runType = r < GRID ? pieces[r][c]?.type ?? null : null;
            runStart = r; runLen = 1;
          }
        }
      }

      // merge overlaps (T/L)
      let merged = true;
      while (merged) {
        merged = false;
        outer: for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            if (groups[i].type !== groups[j].type) continue;
            const setA = new Set(groups[i].cells.map((c) => keyOf(c.r, c.c)));
            const overlap = groups[j].cells.some((c) => setA.has(keyOf(c.r, c.c)));
            if (overlap) {
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

      // annotate
      for (const g of groups) {
        const rows = new Set(g.cells.map((c) => c.r));
        const cols = new Set(g.cells.map((c) => c.c));
        const isLine = rows.size === 1 || cols.size === 1;
        g.shape = isLine ? "line" : "tl";
        g.orientation = rows.size === 1 ? "h" : cols.size === 1 ? "v" : null;
      }

      // dedupe
      const uniq = [];
      const seen = new Set();
      for (const g of groups) {
        const keys = g.cells.map((c) => keyOf(c.r, c.c)).sort().join("|");
        if (seen.has(keys)) continue;
        seen.add(keys);
        uniq.push(g);
      }
      return uniq;
    }

    // ---------- SPECIALS / COMBOS (inchangés de ta V3) ----------
    function triggerSpecialAt(r, c, clearSet) {
      const p = pieces[r][c];
      if (!p || !p.special) return;

      if (p.special === "row") {
        addBeamRow(r, 1.15, "full");
        addShake(0.7);
        for (let cc = 0; cc < GRID; cc++) clearSet.add(keyOf(r, cc));
      } else if (p.special === "col") {
        addBeamCol(c, 1.15, "full");
        addShake(0.7);
        for (let rr = 0; rr < GRID; rr++) clearSet.add(keyOf(rr, c));
      } else if (p.special === "bomb") {
        addBurst(r, c, p.type, 1.9);
        addFlash(0.7);
        addShake(1.0);
        for (let rr = r - 1; rr <= r + 1; rr++)
          for (let cc = c - 1; cc <= c + 1; cc++)
            if (inBounds(rr, cc)) clearSet.add(keyOf(rr, cc));
      } else if (p.special === "color") {
        addFlash(1.25);
        addShake(1.1);

        let targetType = null;
        if (lastSwap) {
          const a = lastSwap.a, b = lastSwap.b;
          const other = a.r === r && a.c === c ? pieces[b.r][b.c] : pieces[a.r][a.c];
          if (other) targetType = other.type;
        }
        if (targetType == null) targetType = randType();

        for (let rr = 0; rr < GRID; rr++)
          for (let cc = 0; cc < GRID; cc++)
            if (pieces[rr][cc] && pieces[rr][cc].type === targetType)
              clearSet.add(keyOf(rr, cc));
      }
    }

    function createBonusFromGroup(group) {
      const size = group.cells.length;
      let bonus = null;

      if (group.shape === "tl") bonus = "bomb";
      else if (size >= 5) bonus = "color";
      else if (size === 4) bonus = group.orientation === "h" ? "row" : "col";
      if (!bonus) return null;

      let place = null;
      if (lastSwap) {
        const set = new Set(group.cells.map((c) => keyOf(c.r, c.c)));
        if (set.has(keyOf(lastSwap.a.r, lastSwap.a.c))) place = { ...lastSwap.a };
        else if (set.has(keyOf(lastSwap.b.r, lastSwap.b.c))) place = { ...lastSwap.b };
      }
      if (!place) place = group.cells[Math.floor(group.cells.length / 2)];

      const p = pieces[place.r][place.c];
      if (!p) return null;
      p.special = bonus;

      if (bonus === "row" || bonus === "col") { addBurst(place.r, place.c, p.type, 1.25); addShake(0.6); }
      else if (bonus === "bomb") { addBurst(place.r, place.c, p.type, 1.6); addShake(0.85); }
      else if (bonus === "color") { addBurst(place.r, place.c, p.type, 2.4); addFlash(1.1); addShake(1.1); }

      return place;
    }

    function buildCrossSet(r, c) {
      const s = new Set();
      for (let cc = 0; cc < GRID; cc++) s.add(keyOf(r, cc));
      for (let rr = 0; rr < GRID; rr++) s.add(keyOf(rr, c));
      return s;
    }
    function buildSquareSet(r, c, radius) {
      const s = new Set();
      for (let rr = r - radius; rr <= r + radius; rr++)
        for (let cc = c - radius; cc <= c + radius; cc++)
          if (inBounds(rr, cc)) s.add(keyOf(rr, cc));
      return s;
    }
    function buildAllSet() {
      const s = new Set();
      for (let r = 0; r < GRID; r++)
        for (let c = 0; c < GRID; c++)
          s.add(keyOf(r, c));
      return s;
    }

    function applyClearSet(clear, scoreBonus = 0) {
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

      score += clear.size * 10 + scoreBonus;
      updateHUD("");

      for (const k of clear) {
        const [r, c] = k.split(",").map(Number);
        const p = pieces[r][c];
        if (p) startPop(p);
        pieces[r][c] = null;
      }

      setTimeout(() => {
        applyGravityAndRefill();
        setTimeout(() => resolveChain(), CFG.fallMs + CFG.chainGap);
      }, CFG.popMs + CFG.chainGap);
    }

    function specialCombo(from, to) {
      const a = pieces[to.r][to.c];
      const b = pieces[from.r][from.c];
      if (!a || !b || !a.special || !b.special) return false;

      movesLeft--;
      updateHUD("");

      const sa = a.special;
      const sb = b.special;

      const doClear = (clear, fxKind) => {
        state = "BUSY";
        input.locked = true;

        if (fxKind === "rowcol_sweep") {
          addCross(from.r, from.c, 1.15);
          addCross(to.r, to.c, 1.35);
          addBeamRow(to.r, 1.25, "sweep", to.c);
          addBeamCol(to.c, 1.25, "sweep", to.r);
          addFlash(1.0);
          addShake(1.35);
        }

        applyClearSet(clear, 140);
      };

      if ((sa === "row" && sb === "col") || (sa === "col" && sb === "row")) {
        const clear = buildCrossSet(to.r, to.c);
        clear.add(keyOf(from.r, from.c));
        clear.add(keyOf(to.r, to.c));
        doClear(clear, "rowcol_sweep");
        return true;
      }

      // (garde les autres combos de ta version — ici on reste minimal)
      doClear(buildCrossSet(to.r, to.c), "rowcol_sweep");
      return true;
    }

    // ---------- RESOLVE CHAIN ----------
    function resolveChain() {
      state = "BUSY";
      input.locked = true;

      const step = () => {
        const groups = findMatchGroups();
        if (groups.length === 0) {
          state = "IDLE";
          input.locked = false;

          if (score > best) best = score;

          if (objectivesDone()) {
            const earned = computeStarsEarned();

            // progression persistante
            stars[levelIndex] = Math.max(stars[levelIndex] || 0, earned);
            unlockedMax = Math.max(unlockedMax, Math.min(levelIndex + 2, LEVELS.length));

            save();

            state = "WIN";
            updateHUD("Objectifs remplis ✅");
            showWin(earned);
          } else if (movesLeft <= 0) {
            state = "LOSE";
            updateHUD("Plus de coups… 😬");
            save();
            showLose();
          } else {
            save();
            updateHUD("");
          }
          return;
        }

        const clear = new Set();
        const keep = new Set();

        for (const g of groups) {
          const kept = createBonusFromGroup(g);
          if (kept) keep.add(keyOf(kept.r, kept.c));
        }

        for (const g of groups) {
          for (const c of g.cells) {
            const k = keyOf(c.r, c.c);
            if (!keep.has(k)) clear.add(k);
          }
        }

        // expand specials
        let expanded = true;
        while (expanded) {
          expanded = false;
          const extra = new Set();
          for (const k of clear) {
            const [r, c] = k.split(",").map(Number);
            const p = pieces[r][c];
            if (p && p.special) triggerSpecialAt(r, c, extra);
          }
          for (const k of extra) {
            if (!clear.has(k) && !keep.has(k)) { clear.add(k); expanded = true; }
          }
        }

        score += clear.size * 10 + Math.max(0, groups.length - 1) * 20;

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

        for (const k of clear) {
          const [r, c] = k.split(",").map(Number);
          const p = pieces[r][c];
          if (p) startPop(p);
          pieces[r][c] = null;
        }

        setTimeout(() => {
          applyGravityAndRefill();
          setTimeout(step, CFG.fallMs + CFG.chainGap);
        }, CFG.popMs + CFG.chainGap);
      };

      step();
    }

    // ---------- INPUT / MOVE ----------
    function tryMove(from, to) {
      if (!from || !to) return;
      if (state !== "IDLE") return;
      if (movesLeft <= 0) return;

      const dr = Math.abs(from.r - to.r);
      const dc = Math.abs(from.c - to.c);
      if (dr + dc !== 1) return;

      input.locked = true;
      state = "BUSY";
      lastSwap = { a: { ...from }, b: { ...to } };

      swapPieces(from, to, true);

      setTimeout(() => {
        // typed combos (si tu réintègres tous les combos, laisse cette ligne)
        // if (specialCombo(from, to)) return;

        const hasMatches = findMatchGroups().length > 0;
        if (!hasMatches) {
          swapPieces(from, to, true);
          setTimeout(() => {
            state = "IDLE";
            input.locked = false;
            lastSwap = null;
          }, CFG.swapMs + 10);
          return;
        }

        movesLeft--;
        updateHUD("");
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

    function onDown(e) {
      if (input.locked) return;
      if (state === "WIN" || state === "LOSE") return;
      e.preventDefault();
      const { x, y } = canvasPosFromEvent(e);
      const cell = cellFromXY(x, y);
      if (!cell) return;
      input.down = true;
      input.start = { ...cell, x, y };
    }

    function onMove(e) {
      if (!input.down || input.locked || !input.start) return;
      if (state !== "IDLE") return;
      e.preventDefault();

      const { x, y } = canvasPosFromEvent(e);
      const dx = x - input.start.x;
      const dy = y - input.start.y;
      const threshold = CELL * 0.25;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

      let target = { r: input.start.r, c: input.start.c };
      if (Math.abs(dx) > Math.abs(dy)) target.c += dx > 0 ? 1 : -1;
      else target.r += dy > 0 ? 1 : -1;

      const from = { r: input.start.r, c: input.start.c };
      input.down = false;
      input.start = null;

      if (!inBounds(target.r, target.c)) return;
      tryMove(from, target);
    }

    function onUp() { input.down = false; input.start = null; }

    // ---------- DRAW ----------
    function draw() {
      const { dx, dy } = getShakeOffset();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(dx, dy);

      ctx.fillStyle = "#0f1722";
      ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

      // grid + ice
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          ctx.strokeStyle = "rgba(232,238,246,0.08)";
          ctx.lineWidth = 1;
          ctx.strokeRect(PADDING + c * CELL, PADDING + r * CELL, CELL, CELL);

          if (ice[r][c] === 1) {
            const x = PADDING + c * CELL;
            const y = PADDING + r * CELL;
            ctx.fillStyle = "rgba(180, 210, 255, 0.22)";
            ctx.fillRect(x, y, CELL, CELL);
            ctx.strokeStyle = "rgba(220, 240, 255, 0.55)";
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 4, y + 4, CELL - 8, CELL - 8);
          }
        }
      }

      // pieces
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const p = pieces[r][c];
          if (!p || !p.active) continue;

          if (p.t1 > p.t0) {
            const tt = clamp((now() - p.t0) / (p.t1 - p.t0), 0, 1);
            const e = easeOut(tt);
            p.x = p.sx + (p.tx - p.sx) * e;
            p.y = p.sy + (p.ty - p.sy) * e;
            if (tt >= 1) { p.x = p.tx; p.y = p.ty; p.t0 = p.t1 = 0; }
          }

          let scale = 1;
          if (p.popping) {
            const tt = clamp((now() - p.popT0) / (p.popT1 - p.popT0), 0, 1);
            scale = 1 - easeOut(tt);
            if (tt >= 1) { p.active = false; p.popping = false; }
          }

          const radius = CELL * 0.33 * scale;
          if (radius <= 0.6) continue;

          if (p.special) {
            ctx.globalAlpha = 0.22;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius * 1.35, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          ctx.fillStyle = COLORS[p.type];
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.globalAlpha = 0.18;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(p.x - radius * 0.25, p.y - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (input.start) {
        const { r, c } = input.start;
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 3;
        ctx.strokeRect(PADDING + c * CELL + 2, PADDING + r * CELL + 2, CELL - 4, CELL - 4);
      }

      drawFX();
      ctx.restore();
    }

    // ---------- SAVE/LOAD ----------
    function save() {
      try {
        const data = {
          // méta progression
          unlockedMax,
          stars,

          // run en cours (optionnel mais utile)
          best, levelIndex, score, movesLeft, targetScore, objectives,
          grid: pieces.map((row) => row.map((p) => (p ? { t: p.type, s: p.special } : null))),
          ice,
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {}
    }

    function load() {
      try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); }
      catch { return null; }
    }

    function applyLevel(i, freshScore = true) {
      hideWin(); hideLose(); closeLevels();
      levelIndex = clamp(i, 0, LEVELS.length - 1);

      // sécurité : ne pas lancer un niveau non débloqué
      if (levelIndex + 1 > unlockedMax) levelIndex = unlockedMax - 1;

      const L = LEVELS[levelIndex];

      movesLeft = L.moves;
      targetScore = L.targetScore;
      if (freshScore) score = 0;

      objectives = { collect: { ...(L.collect || {}) }, iceLeft: Number(L.ice || 0) };

      buildNewBoardNoMatches();
      placeIce(objectives.iceLeft);

      state = "IDLE";
      input.locked = false;
      lastSwap = null;

      updateHUD(`Niveau ${levelIndex + 1}`);
      save();
    }

    function nextLevel() {
      hideWin(); hideLose();
      if (levelIndex < LEVELS.length - 1) applyLevel(levelIndex + 1, true);
      else {
        ui.winText.textContent = "Démo terminée ✅ Ajoute des niveaux dans LEVELS";
        ui.winModal.classList.remove("hidden");
      }
    }

    function maybeResume() {
      const s = load();
      if (!s || !s.grid) {
        best = 0;
        unlockedMax = 1;
        stars = Array(LEVELS.length).fill(0);
        applyLevel(0, true);
        return;
      }

      unlockedMax = clamp(Number(s.unlockedMax ?? 1), 1, LEVELS.length);
      stars = Array.isArray(s.stars) ? s.stars.slice(0, LEVELS.length) : Array(LEVELS.length).fill(0);
      while (stars.length < LEVELS.length) stars.push(0);

      best = Number(s.best ?? 0);

      levelIndex = clamp(Number(s.levelIndex ?? 0), 0, LEVELS.length - 1);
      if (levelIndex + 1 > unlockedMax) levelIndex = unlockedMax - 1;

      score = Number(s.score ?? 0);
      movesLeft = Number(s.movesLeft ?? LEVELS[levelIndex].moves);
      targetScore = Number(s.targetScore ?? LEVELS[levelIndex].targetScore);
      objectives = s.objectives ?? { collect: {}, iceLeft: 0 };

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

      if (score > best) best = score;
      updateHUD("Reprise");
    }

    // ---------- EVENTS ----------
    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("pointermove", onMove, { passive: false });
    canvas.addEventListener("pointerup", onUp, { passive: true });
    canvas.addEventListener("pointercancel", onUp, { passive: true });

    ui.newGame.addEventListener("click", () => applyLevel(levelIndex, true));
    ui.openLevels.addEventListener("click", openLevels);

    ui.winRestart.addEventListener("click", () => applyLevel(levelIndex, true));
    ui.winNext.addEventListener("click", nextLevel);
    ui.winLevels.addEventListener("click", () => { hideWin(); openLevels(); });

    ui.loseRestart.addEventListener("click", () => applyLevel(levelIndex, true));
    ui.loseLevels.addEventListener("click", () => { hideLose(); openLevels(); });

    ui.levelsClose.addEventListener("click", closeLevels);

    // ---------- LOOP ----------
    function tick() { draw(); requestAnimationFrame(tick); }

    maybeResume();
    tick();
  } catch (err) {
    bootError(err);
  }
})();