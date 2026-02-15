(() => {
  const bootError = (err) => {
    const el = document.getElementById("bootError");
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent =
      "Le jeu a crash.\n\n" +
      String(err?.stack || err) +
      "\n\nAstuce: vérifie que index.html / style.css / game.js sont bien au même endroit (Pages).";
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
    };

    const SAVE_KEY = "match3_v2_save";

    const now = () => performance.now();
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const inBounds = (r, c) => r >= 0 && r < GRID && c >= 0 && c < GRID;
    const keyOf = (r, c) => `${r},${c}`;
    const randType = () => Math.floor(Math.random() * TYPES);

    const LEVELS = [
      { moves: 20, targetScore: 800,  collect: { 0: 12, 3: 10 }, ice: 8  },
      { moves: 22, targetScore: 1200, collect: { 2: 14, 5: 12 }, ice: 12 },
      { moves: 25, targetScore: 1800, collect: { 1: 18, 4: 14 }, ice: 16 },
    ];

    let levelIndex = 0;
    let score = 0;
    let best = 0;
    let movesLeft = 0;
    let targetScore = 0;

    let objectives = { collect: {}, iceLeft: 0 };

    let pieces = [];
    let ice = [];

    let state = "IDLE"; // IDLE | BUSY | WIN | LOSE
    let input = { down: false, start: null, locked: false };
    let lastSwap = null;

    const fx = { bursts: [], flash: null, shake: null };

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

    function addBurst(r, c, type, intensity = 1) {
      const { x, y } = xyFromCell(r, c);
      fx.bursts.push({ x, y, color: COLORS[type], intensity, t0: now(), dur: CFG.fxBurstMs });
    }
    function addFlash(intensity = 1) { fx.flash = { t0: now(), dur: CFG.fxFlashMs, intensity }; }
    function addShake(intensity = 1) { fx.shake = { t0: now(), dur: CFG.shakeMs, intensity }; }

    function getShakeOffset() {
      if (!fx.shake) return { dx: 0, dy: 0 };
      const t = now();
      const p = clamp((t - fx.shake.t0) / fx.shake.dur, 0, 1);
      if (p >= 1) { fx.shake = null; return { dx: 0, dy: 0 }; }
      const a = (1 - p) * 6 * fx.shake.intensity;
      const dx = (Math.sin(t * 0.08) + Math.sin(t * 0.13)) * 0.5 * a;
      const dy = (Math.cos(t * 0.09) + Math.cos(t * 0.11)) * 0.5 * a;
      return { dx, dy };
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

    function makePiece(r, c, type, special = null) {
      const { x, y } = xyFromCell(r, c);
      return { r, c, type, special, x, y, sx: x, sy: y, tx: x, ty: y, t0: 0, t1: 0, popping: false, popT0: 0, popT1: 0, active: true };
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

    function resetArrays() {
      pieces = Array.from({ length: GRID }, () => Array(GRID).fill(null));
      ice = Array.from({ length: GRID }, () => Array(GRID).fill(0));
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

    function showWin() {
      ui.winText.textContent = `Niveau ${levelIndex + 1} validé ✅`;
      ui.winModal.classList.remove("hidden");
    }
    function hideWin() { ui.winModal.classList.add("hidden"); }

    // NEW: details game over
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

    function openLevels() {
      ui.levelsGrid.innerHTML = "";
      LEVELS.forEach((L, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = `Niv ${i + 1}`;
        b.onclick = () => {
          closeLevels();
          applyLevel(i, true);
        };
        ui.levelsGrid.appendChild(b);
      });
      ui.levelsModal.classList.remove("hidden");
    }
    function closeLevels() { ui.levelsModal.classList.add("hidden"); }

    function decIceIfAny(r, c) {
      if (ice[r][c] === 1) { ice[r][c] = 0; objectives.iceLeft = Math.max(0, objectives.iceLeft - 1); }
    }
    function applyCollect(type, count) {
      if (objectives.collect[type] != null) objectives.collect[type] = Math.max(0, objectives.collect[type] - count);
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

    function triggerSpecialAt(r, c, clearSet) {
      const p = pieces[r][c];
      if (!p || !p.special) return;

      if (p.special === "row") for (let cc = 0; cc < GRID; cc++) clearSet.add(keyOf(r, cc));
      else if (p.special === "col") for (let rr = 0; rr < GRID; rr++) clearSet.add(keyOf(rr, c));
      else if (p.special === "bomb") {
        for (let rr = r - 1; rr <= r + 1; rr++)
          for (let cc = c - 1; cc <= c + 1; cc++)
            if (inBounds(rr, cc)) clearSet.add(keyOf(rr, cc));
      } else if (p.special === "color") {
        let targetType = null;
        if (lastSwap) {
          const a = lastSwap.a, b = lastSwap.b;
          const other = a.r === r && a.c === c ? pieces[b.r][b.c] : pieces[a.r][a.c];
          if (other) targetType = other.type;
        }
        if (targetType == null) targetType = randType();
        for (let rr = 0; rr < GRID; rr++)
          for (let cc = 0; cc < GRID; cc++)
            if (pieces[rr][cc] && pieces[rr][cc].type === targetType) clearSet.add(keyOf(rr, cc));
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
      else if (bonus === "bomb") { addBurst(place.r, place.c, p.type, 1.6); addShake(0.8); }
      else if (bonus === "color") { addBurst(place.r, place.c, p.type, 2.4); addFlash(1.2); addShake(1.1); }

      return place;
    }

    function resolveChain() {
      state = "BUSY";
      input.locked = true;

      const step = () => {
        const groups = findMatchGroups();
        if (groups.length === 0) {
          state = "IDLE";
          input.locked = false;

          if (score > best) best = score;
          save();

          if (objectivesDone()) {
            state = "WIN";
            updateHUD("Objectifs remplis ✅");
            showWin();
          } else if (movesLeft <= 0) {
            state = "LOSE";
            updateHUD("Plus de coups… 😬");
            showLose();
          } else updateHUD("");

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
        const aNow = pieces[to.r][to.c];
        const bNow = pieces[from.r][from.c];

        const immediateColor = aNow?.special === "color" || bNow?.special === "color";
        const hasMatches = findMatchGroups().length > 0;

        if (!immediateColor && !hasMatches) {
          swapPieces(from, to, true);
          setTimeout(() => { state = "IDLE"; input.locked = false; lastSwap = null; }, CFG.swapMs + 10);
          return;
        }

        movesLeft--;
        updateHUD("");
        if (immediateColor) { addFlash(1.1); addShake(1.0); }
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

    function draw() {
      const { dx, dy } = getShakeOffset();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(dx, dy);

      ctx.fillStyle = "#0f1722";
      ctx.fillRect(PADDING, PADDING, BOARD_SIZE, BOARD_SIZE);

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

      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const p = pieces[r][c];
          if (!p || !p.active) continue;

          if (p.t1 > p.t0) {
            const t = clamp((now() - p.t0) / (p.t1 - p.t0), 0, 1);
            const e = easeOut(t);
            p.x = p.sx + (p.tx - p.sx) * e;
            p.y = p.sy + (p.ty - p.sy) * e;
            if (t >= 1) { p.x = p.tx; p.y = p.ty; p.t0 = p.t1 = 0; }
          }

          let scale = 1;
          if (p.popping) {
            const t = clamp((now() - p.popT0) / (p.popT1 - p.popT0), 0, 1);
            scale = 1 - easeOut(t);
            if (t >= 1) { p.active = false; p.popping = false; }
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

    function save() {
      try {
        const data = {
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
      if (!s || !s.grid) { best = 0; applyLevel(0, true); return; }

      best = Number(s.best ?? 0);
      levelIndex = clamp(Number(s.levelIndex ?? 0), 0, LEVELS.length - 1);
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

      if (objectivesDone()) { state = "WIN"; showWin(); }
      else if (movesLeft <= 0) { state = "LOSE"; showLose(); }
    }

    // events
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

    function tick() { draw(); requestAnimationFrame(tick); }

    maybeResume();
    tick();
  } catch (err) {
    bootError(err);
  }
})();