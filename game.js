(() => {
  const bootError = (err) => {
    const el = document.getElementById("bootError");
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent =
      "Le jeu a crash.\n\n" +
      String(err?.stack || err) +
      "\n\nVérifie que game.js est bien au même endroit que index.html (root) et que le nom est EXACTEMENT 'game.js'.";
  };

  try {
    // iOS: block pinch / double-tap zoom (si HTML/CSS le permettent déjà)
    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
    let _lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (e) => {
        const t = Date.now();
        if (t - _lastTouchEnd <= 300) e.preventDefault();
        _lastTouchEnd = t;
      },
      { passive: false }
    );

    const canvas = document.getElementById("game");
    if (!canvas) throw new Error("Canvas #game introuvable");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Impossible d'obtenir le contexte 2D");

    const ui = {
      level: document.getElementById("level"),
      score: document.getElementById("score"),
      best: document.getElementById("best"),
      moves: document.getElementById("moves"),
      objectives: document.getElementById("objectives"),
      status: document.getElementById("status"),

      newGame: document.getElementById("newGame"),
      levelsBtn: document.getElementById("levelsBtn"),

      winModal: document.getElementById("winModal"),
      winText: document.getElementById("winText"),
      winRestart: document.getElementById("winRestart"),
      winNext: document.getElementById("winNext"),
      winMenu: document.getElementById("winMenu"),

      loseModal: document.getElementById("loseModal"),
      loseText: document.getElementById("loseText"),
      loseRestart: document.getElementById("loseRestart"),
      loseMenu: document.getElementById("loseMenu"),

      levelsModal: document.getElementById("levelsModal"),
      levelsClose: document.getElementById("levelsClose"),
      mapWrap: document.getElementById("mapWrap"),
    };

    // sécurité : si un id manque, iOS peut juste "ne rien afficher"
    const must = [
      "level",
      "score",
      "best",
      "moves",
      "objectives",
      "newGame",
      "levelsBtn",
      "winModal",
      "winRestart",
      "winNext",
      "winMenu",
      "loseModal",
      "loseRestart",
      "loseMenu",
      "levelsModal",
      "levelsClose",
      "mapWrap",
    ];
    for (const k of must) {
      if (!ui[k]) throw new Error(`Element manquant: #${k}`);
    }

    // ---------- CONFIG ----------
    const GRID = 8;
    const TYPES = 6;

    const PADDING = 18;
    const BOARD_SIZE = canvas.width - PADDING * 2;
    const CELL = BOARD_SIZE / GRID;

    // ✅ True Tone: on remplace le bleu ciel par du jaune
    const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#facc15", "#a855f7", "#14b8a6"];
    const COLOR_NAMES = ["Rouge", "Orange", "Vert", "Jaune", "Violet", "Turquoise"];

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

    // 30 niveaux (1–10 sans glace, 11–20 glace simple, 21–30 double épaisseur)
    const LEVELS = [
      // 1–10 : pas de glace (objectifs simples -> plus challenge)
      { moves: 20, targetScore: 800,  collect: { 0: 10 },                          ice: 0,  iceStrength: 0 },
      { moves: 22, targetScore: 1200, collect: { 2: 14, 5: 9 },                    ice: 0,  iceStrength: 0 },
      { moves: 24, targetScore: 1800, collect: { 1: 16 },                          ice: 0,  iceStrength: 0 },
      { moves: 24, targetScore: 2200, collect: { 3: 14, 4: 10 },                   ice: 0,  iceStrength: 0 },
      { moves: 25, targetScore: 2600, collect: { 0: 12, 2: 12 },                   ice: 0,  iceStrength: 0 },
      { moves: 25, targetScore: 3000, collect: { 5: 18 },                          ice: 0,  iceStrength: 0 },
      { moves: 26, targetScore: 3500, collect: { 1: 14, 3: 14 },                   ice: 0,  iceStrength: 0 },
      { moves: 26, targetScore: 4200, collect: { 2: 16, 4: 12 },                   ice: 0,  iceStrength: 0 },
      { moves: 27, targetScore: 5000, collect: { 0: 14, 5: 14 },                   ice: 0,  iceStrength: 0 },
      { moves: 28, targetScore: 6000, collect: { 1: 16, 2: 16, 3: 10 },             ice: 0,  iceStrength: 0 },

      // 11–20 : glace simple (iceStrength = 1) + quantité croissante
      { moves: 24, targetScore: 1600, collect: { 0: 10 },                          ice: 6,  iceStrength: 1 },
      { moves: 24, targetScore: 2000, collect: { 2: 12 },                          ice: 8,  iceStrength: 1 },
      { moves: 25, targetScore: 2400, collect: { 5: 12 },                          ice: 10, iceStrength: 1 },
      { moves: 25, targetScore: 2900, collect: { 1: 12, 3: 10 },                   ice: 12, iceStrength: 1 },
      { moves: 26, targetScore: 3400, collect: { 4: 12 },                          ice: 14, iceStrength: 1 },
      { moves: 26, targetScore: 4000, collect: { 0: 10, 2: 10 },                   ice: 16, iceStrength: 1 },
      { moves: 27, targetScore: 4600, collect: { 1: 12, 5: 10 },                   ice: 18, iceStrength: 1 },
      { moves: 27, targetScore: 5200, collect: { 3: 14 },                          ice: 20, iceStrength: 1 },
      { moves: 28, targetScore: 6000, collect: { 2: 14, 4: 10 },                   ice: 22, iceStrength: 1 },
      { moves: 28, targetScore: 7000, collect: { 0: 12, 1: 12, 5: 8 },             ice: 24, iceStrength: 1 },

      // 21–30 : double-glace (iceStrength = 2) + quantité croissante
      { moves: 26, targetScore: 2400, collect: { 2: 10 },                          ice: 8,  iceStrength: 2 },
      { moves: 26, targetScore: 3000, collect: { 0: 10 },                          ice: 10, iceStrength: 2 },
      { moves: 27, targetScore: 3600, collect: { 5: 12 },                          ice: 12, iceStrength: 2 },
      { moves: 27, targetScore: 4200, collect: { 3: 12, 4: 10 },                   ice: 14, iceStrength: 2 },
      { moves: 28, targetScore: 5000, collect: { 1: 14 },                          ice: 16, iceStrength: 2 },
      { moves: 28, targetScore: 5800, collect: { 0: 12, 2: 12 },                   ice: 18, iceStrength: 2 },
      { moves: 29, targetScore: 6800, collect: { 4: 14 },                          ice: 20, iceStrength: 2 },
      { moves: 29, targetScore: 8000, collect: { 1: 14, 5: 12 },                   ice: 24, iceStrength: 2 },
      { moves: 30, targetScore: 9500, collect: { 2: 16, 3: 12 },                   ice: 28, iceStrength: 2 },
      { moves: 30, targetScore: 11000, collect: { 0: 14, 1: 14, 4: 12 },           ice: 32, iceStrength: 2 },
    ];

    // ---------- STATE ----------
    let levelIndex = 0;
    let score = 0;
    let best = 0;
    let movesLeft = 0;

    let targetScore = 0;
    let objectives = { collect: {}, iceLeft: 0 };

    let unlockedMax = 1; // niveaux débloqués (1-indexé)
    let starsByLevel = {}; // { levelNumber: 0..3 }

    const pieces = Array.from({ length: GRID }, () => Array(GRID).fill(0));
    const ice = Array.from({ length: GRID }, () => Array(GRID).fill(0)); // 0/1/2

    const input = { locked: false, down: null, over: null };
    let lastSwap = null;
    let state = "IDLE";

    // FX
    const fx = {
      bursts: [], // {x,y,t,kind}
      flashes: [], // {x,y,t,kind}
      shakes: [], // {t,amp}
      beams: [], // {x,y,t,dir}
      crosses: [], // {x,y,t}
    };

    // ---------- SAVE/LOAD ----------
    function load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") return;
        best = Number(data.best || 0);
        unlockedMax = Number(data.unlockedMax || 1);
        starsByLevel = data.starsByLevel || {};
      } catch {}
    }

    function save() {
      try {
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({
            best,
            unlockedMax,
            starsByLevel,
          })
        );
      } catch {}
    }

    // ---------- HELPERS ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function xyFromCell(r, c) {
      return { x: PADDING + c * CELL + CELL / 2, y: PADDING + r * CELL + CELL / 2 };
    }

    function cellFromXY(x, y) {
      const cx = Math.floor((x - PADDING) / CELL);
      const cy = Math.floor((y - PADDING) / CELL);
      if (cx < 0 || cx >= GRID || cy < 0 || cy >= GRID) return null;
      return { r: cy, c: cx };
    }

    function randType() {
      return Math.floor(Math.random() * TYPES);
    }

    function inBounds(r, c) {
      return r >= 0 && r < GRID && c >= 0 && c < GRID;
    }

    function sumIceLayers() {
      let left = 0;
      for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) left += ice[r][c];
      return left;
    }

    // ---------- BOARD GEN ----------
    function hasMatchAt(r, c) {
      const t = pieces[r][c];
      // horizontal
      let cnt = 1;
      for (let cc = c - 1; cc >= 0 && pieces[r][cc] === t; cc--) cnt++;
      for (let cc = c + 1; cc < GRID && pieces[r][cc] === t; cc++) cnt++;
      if (cnt >= 3) return true;

      // vertical
      cnt = 1;
      for (let rr = r - 1; rr >= 0 && pieces[rr][c] === t; rr--) cnt++;
      for (let rr = r + 1; rr < GRID && pieces[rr][c] === t; rr++) cnt++;
      return cnt >= 3;
    }

    function buildNewBoardNoMatches() {
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          ice[r][c] = 0;
          let t = randType();
          pieces[r][c] = t;

          // re-roll to avoid immediate matches
          let guard = 0;
          while (hasMatchAt(r, c) && guard++ < 20) {
            t = randType();
            pieces[r][c] = t;
          }
        }
      }
    }

    function placeIce(count, strength = 1) {
      const cells = [];
      for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) cells.push({ r, c });

      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }

      const n = Math.min(count, cells.length);
      for (let i = 0; i < n; i++) {
        ice[cells[i].r][cells[i].c] = strength;
      }
    }

    function decIceIfAny(r, c) {
      if (ice[r][c] > 0) {
        ice[r][c] -= 1;
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
      for (const k of Object.keys(objectives.collect || {})) {
        if ((objectives.collect[k] || 0) > 0) return false;
      }
      if ((objectives.iceLeft || 0) > 0) return false;
      return true;
    }

    // ---------- MATCH FIND ----------
    function findRuns() {
      const marked = Array.from({ length: GRID }, () => Array(GRID).fill(false));
      let any = false;

      // horizontal runs
      for (let r = 0; r < GRID; r++) {
        let start = 0;
        while (start < GRID) {
          const t = pieces[r][start];
          let end = start + 1;
          while (end < GRID && pieces[r][end] === t) end++;
          const len = end - start;
          if (len >= 3) {
            any = true;
            for (let c = start; c < end; c++) marked[r][c] = true;
          }
          start = end;
        }
      }

      // vertical runs
      for (let c = 0; c < GRID; c++) {
        let start = 0;
        while (start < GRID) {
          const t = pieces[start][c];
          let end = start + 1;
          while (end < GRID && pieces[end][c] === t) end++;
          const len = end - start;
          if (len >= 3) {
            any = true;
            for (let r = start; r < end; r++) marked[r][c] = true;
          }
          start = end;
        }
      }

      return { any, marked };
    }

    function popMarked(marked) {
      let popped = 0;
      const perType = new Array(TYPES).fill(0);

      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          if (!marked[r][c]) continue;

          const t = pieces[r][c];
          perType[t] += 1;
          popped += 1;

          // glace: on casse quand une pièce matchée se trouve dessus
          decIceIfAny(r, c);

          // remove
          pieces[r][c] = -1;
        }
      }

      // scoring simple + bonus par taille globale
      if (popped > 0) {
        const base = popped * 30;
        score += base;
        best = Math.max(best, score);

        // FX satisfaisante
        const kind = popped >= 10 ? "HUGE" : popped >= 7 ? "BIG" : popped >= 4 ? "MED" : "SMALL";
        fx.bursts.push({ x: canvas.width / 2, y: canvas.height / 2, t: performance.now(), kind });

        // collect objectives
        for (let t = 0; t < TYPES; t++) {
          if (perType[t] > 0) applyCollect(t, perType[t]);
        }
      }

      return popped;
    }

    function collapse() {
      // gravity
      for (let c = 0; c < GRID; c++) {
        let write = GRID - 1;
        for (let r = GRID - 1; r >= 0; r--) {
          if (pieces[r][c] !== -1) {
            pieces[write][c] = pieces[r][c];
            if (write !== r) pieces[r][c] = -1;
            write--;
          }
        }
        for (let r = write; r >= 0; r--) {
          pieces[r][c] = randType();
        }
      }
    }

    function resolveAll() {
      let guard = 0;
      while (guard++ < 40) {
        const { any, marked } = findRuns();
        if (!any) break;
        popMarked(marked);
        collapse();
      }
    }

    // ---------- SWAP ----------
    function swapCells(a, b) {
      const t = pieces[a.r][a.c];
      pieces[a.r][a.c] = pieces[b.r][b.c];
      pieces[b.r][b.c] = t;
    }

    function adjacent(a, b) {
      const dr = Math.abs(a.r - b.r);
      const dc = Math.abs(a.c - b.c);
      return dr + dc === 1;
    }

    function trySwap(a, b) {
      if (!adjacent(a, b)) return false;

      swapCells(a, b);
      const { any } = findRuns();
      if (!any) {
        swapCells(a, b);
        return false;
      }

      movesLeft = Math.max(0, movesLeft - 1);

      // resolve chain
      resolveAll();

      updateHUD("");

      // end conditions
      if (objectivesDone()) {
        win();
        return true;
      }
      if (movesLeft <= 0) {
        lose();
        return true;
      }

      return true;
    }

    // ---------- UI / MODALS ----------
    function updateHUD(msg = "") {
      ui.level.textContent = `Niv ${levelIndex + 1}`;
      ui.score.textContent = String(score);
      ui.best.textContent = String(best);
      ui.moves.textContent = String(movesLeft);

      // objectives list
      ui.objectives.innerHTML = "";

      const liScore = document.createElement("li");
      liScore.textContent = `Atteindre ${targetScore} points (${score}/${targetScore})`;
      ui.objectives.appendChild(liScore);

      for (const k of Object.keys(objectives.collect || {})) {
        const needed = objectives.collect[k] || 0;
        if (needed <= 0) continue;
        const li = document.createElement("li");
        li.textContent = `Collecter ${needed} ${COLOR_NAMES[Number(k)]}`;
        ui.objectives.appendChild(li);
      }

      if ((objectives.iceLeft || 0) > 0) {
        const li = document.createElement("li");
        li.textContent = `Casser la glace : ${objectives.iceLeft} restante(s)`;
        ui.objectives.appendChild(li);
      }

      if (ui.status) ui.status.textContent = msg;
    }

    function starsForLevelPerformance() {
      // ⭐⭐⭐: très bon / ⭐⭐: ok / ⭐: juste réussi
      // critère simple : % coups restants
      const L = LEVELS[levelIndex];
      const ratio = movesLeft / Math.max(1, L.moves);
      if (ratio >= 0.45) return 3;
      if (ratio >= 0.20) return 2;
      return 1;
    }

    function win() {
      input.locked = true;

      const s = starsForLevelPerformance();
      starsByLevel[String(levelIndex + 1)] = Math.max(Number(starsByLevel[String(levelIndex + 1)] || 0), s);

      unlockedMax = Math.max(unlockedMax, levelIndex + 2); // débloque le suivant
      save();

      ui.winText.textContent = `Objectifs remplis ✅\n⭐ ${s} étoile(s)`;
      ui.winModal.classList.remove("hidden");
    }

    function lose() {
      input.locked = true;
      ui.loseText.textContent = "Objectifs non atteints…";
      ui.loseModal.classList.remove("hidden");
    }

    function hideWin() {
      ui.winModal.classList.add("hidden");
    }
    function hideLose() {
      ui.loseModal.classList.add("hidden");
    }

    function openLevels() {
      renderMap();
      ui.levelsModal.classList.remove("hidden");
    }
    function closeLevels() {
      ui.levelsModal.classList.add("hidden");
    }

    function renderMap() {
      // Candy Crush-like simple path
      ui.mapWrap.innerHTML = "";

      const wrap = document.createElement("div");
      wrap.className = "mapWrap";

      // svg path
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "mapPath");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.innerHTML =
        `<path d="M10 90 C 30 70, 30 30, 50 50 S 80 70, 90 10" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2.2" stroke-linecap="round"/>`;
      wrap.appendChild(svg);

      const total = LEVELS.length;
      for (let i = 1; i <= total; i++) {
        const t = (i - 1) / (total - 1);
        // positions le long d'une courbe "S"
        const x = 10 + 80 * t + (Math.sin(t * Math.PI * 2) * 6);
        const y = 90 - 80 * t + (Math.sin(t * Math.PI * 3) * 4);

        const node = document.createElement("button");
        node.type = "button";
        node.className = "mapNode";

        const locked = i > unlockedMax;
        if (locked) node.classList.add("locked");
        if (i === levelIndex + 1) node.classList.add("current");

        node.style.left = `${x}%`;
        node.style.top = `${y}%`;

        const label = document.createElement("div");
        label.className = "nodeLabel";
        label.textContent = String(i);

        const stars = document.createElement("div");
        stars.className = "nodeStars";
        const s = Number(starsByLevel[String(i)] || 0);
        stars.textContent = "★".repeat(s) + "☆".repeat(3 - s);

        node.appendChild(label);
        node.appendChild(stars);

        if (locked) {
          const lock = document.createElement("div");
          lock.className = "nodeLock";
          lock.textContent = "🔒";
          node.appendChild(lock);
        }

        node.addEventListener("click", () => {
          if (locked) return;
          applyLevel(i - 1, true);
          closeLevels();
        });

        wrap.appendChild(node);
      }

      ui.mapWrap.appendChild(wrap);
    }

    // ---------- DRAW ----------
    function drawIceOverlay(x, y, strength) {
      // plus visible + différencie 1 couche / 2 couches
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = strength === 2 ? 0.55 : 0.35;

      ctx.fillStyle = "#cfe8ff";
      ctx.beginPath();
      ctx.roundRect(-CELL * 0.48, -CELL * 0.48, CELL * 0.96, CELL * 0.96, 10);
      ctx.fill();

      // fissures / traits
      ctx.globalAlpha = strength === 2 ? 0.65 : 0.45;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(-CELL * 0.32, -CELL * 0.12);
      ctx.lineTo(CELL * 0.22, CELL * 0.08);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-CELL * 0.10, -CELL * 0.34);
      ctx.lineTo(CELL * 0.14, CELL * 0.30);
      ctx.stroke();

      if (strength === 2) {
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-CELL * 0.36, CELL * 0.26);
        ctx.lineTo(CELL * 0.34, -CELL * 0.22);
        ctx.stroke();
      }

      ctx.restore();
    }

    function drawPiece(x, y, type) {
      ctx.save();
      ctx.translate(x, y);

      // piece
      ctx.fillStyle = COLORS[type];
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.33, 0, Math.PI * 2);
      ctx.fill();

      // highlight
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-CELL * 0.10, -CELL * 0.10, CELL * 0.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    function drawGrid() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // board bg
      ctx.fillStyle = "#0f1722";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#0b1220";
      ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

      // cell lines
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= GRID; i++) {
        const v = PADDING + i * CELL;
        ctx.beginPath();
        ctx.moveTo(PADDING, v);
        ctx.lineTo(PADDING + BOARD_SIZE, v);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(v, PADDING);
        ctx.lineTo(v, PADDING + BOARD_SIZE);
        ctx.stroke();
      }

      // pieces + ice
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const { x, y } = xyFromCell(r, c);
          const t = pieces[r][c];
          if (t >= 0) drawPiece(x, y, t);
          if (ice[r][c] > 0) drawIceOverlay(x, y, ice[r][c]);
        }
      }

      // selection hover
      if (input.over) {
        const { x, y } = xyFromCell(input.over.r, input.over.c);
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        ctx.strokeRect(-CELL * 0.48, -CELL * 0.48, CELL * 0.96, CELL * 0.96);
        ctx.restore();
      }
    }

    // ---------- INPUT ----------
    function onPointerMove(ev) {
      if (input.locked) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
      input.over = cellFromXY(x, y);
    }

    function onPointerDown(ev) {
      if (input.locked) return;
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
      input.down = cellFromXY(x, y);
    }

    function onPointerUp(ev) {
      if (input.locked) return;
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
      const up = cellFromXY(x, y);
      if (input.down && up) {
        trySwap(input.down, up);
      }
      input.down = null;
    }

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", () => (input.down = null));

    // ---------- LEVEL FLOW ----------
    function applyLevel(i, freshScore = true) {
      hideWin();
      hideLose();
      closeLevels();

      levelIndex = clamp(i, 0, LEVELS.length - 1);

      // sécurité : ne pas lancer un niveau non débloqué
      if (levelIndex + 1 > unlockedMax) levelIndex = unlockedMax - 1;

      const L = LEVELS[levelIndex];

      movesLeft = L.moves;
      targetScore = L.targetScore;
      if (freshScore) score = 0;

      objectives = { collect: { ...(L.collect || {}) }, iceLeft: 0 };

      buildNewBoardNoMatches();

      if (Number(L.ice || 0) > 0 && Number(L.iceStrength || 0) > 0) {
        placeIce(Number(L.ice || 0), Number(L.iceStrength || 1));
      }
      objectives.iceLeft = sumIceLayers();

      state = "IDLE";
      input.locked = false;
      lastSwap = null;

      updateHUD(`Niveau ${levelIndex + 1}`);
      save();
    }

    function nextLevel() {
      hideWin();
      hideLose();
      if (levelIndex < LEVELS.length - 1) applyLevel(levelIndex + 1, true);
      else {
        ui.winText.textContent = "Dernier niveau atteint ✅";
        ui.winModal.classList.remove("hidden");
      }
    }

    // ---------- BUTTONS ----------
    ui.newGame.addEventListener("click", () => applyLevel(levelIndex, true));
    ui.levelsBtn.addEventListener("click", openLevels);

    ui.winRestart.addEventListener("click", () => {
      hideWin();
      applyLevel(levelIndex, true);
    });
    ui.winNext.addEventListener("click", () => nextLevel());
    ui.winMenu.addEventListener("click", () => {
      hideWin();
      openLevels();
    });

    ui.loseRestart.addEventListener("click", () => {
      hideLose();
      applyLevel(levelIndex, true);
    });
    ui.loseMenu.addEventListener("click", () => {
      hideLose();
      openLevels();
    });

    ui.levelsClose.addEventListener("click", closeLevels);

    // ---------- LOOP ----------
    function tick() {
      drawGrid();
      requestAnimationFrame(tick);
    }

    // ---------- START ----------
    load();
    updateHUD("✅ game.js chargé");
    applyLevel(levelIndex, true);
    tick();
  } catch (err) {
    bootError(err);
  }
})();