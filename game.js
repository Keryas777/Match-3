(() => {
  const showBootError = (err) => {
    const el = document.getElementById("bootError");
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent =
      "Le jeu a crash au démarrage.\n\n" +
      String(err?.stack || err) +
      "\n\n👉 Vérifie que game.js est bien au même endroit que index.html (root) et que le nom est EXACTEMENT 'game.js'.";
  };

  try {
    // --- iOS: block pinch-to-zoom / double-tap zoom ---
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
    if (!canvas) throw new Error("Canvas #game introuvable");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Impossible d’obtenir le contexte 2D");

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

    // ---- Si un de ces éléments manque, le JS peut crasher selon les versions copiées
    // ---- donc on protège:
    const must = ["level","score","best","moves","objectives","status","newGame","winModal","winText","winRestart","winNext"];
    for (const k of must) if (!el[k]) throw new Error(`Element manquant: #${k}`);

    // ----- Le plus important: si tu avais un game.js incomplet/collé à moitié,
    // ----- c’est typiquement ici que ça plantait. Là tu verras l’erreur.

    // ======== MOTEUR MINIMAL (pour vérifier que tout redessine) ========
    const GRID = 8;
    const TYPES = 6;
    const PADDING = 18;
    const BOARD_SIZE = canvas.width - PADDING * 2;
    const CELL = BOARD_SIZE / GRID;

    const COLORS = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#a855f7","#14b8a6"];
    const COLOR_NAMES = ["Rouge","Orange","Vert","Bleu","Violet","Turquoise"];

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
    let pieces = Array.from({ length: GRID }, () => Array(GRID).fill(0));
    let ice = Array.from({ length: GRID }, () => Array(GRID).fill(0));

    const xyFromCell = (r,c) => ({ x: PADDING + c*CELL + CELL/2, y: PADDING + r*CELL + CELL/2 });

    function updateHUD(msg="") {
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

    function buildBoard() {
      for (let r=0;r<GRID;r++){
        for (let c=0;c<GRID;c++){
          pieces[r][c] = Math.floor(Math.random()*TYPES);
          ice[r][c] = 0;
        }
      }
      // place a bit of ice so you see it
      let left = objectives.iceLeft;
      while (left > 0) {
        const r = Math.floor(Math.random()*GRID);
        const c = Math.floor(Math.random()*GRID);
        if (ice[r][c] === 0) { ice[r][c] = 1; left--; }
      }
    }

    function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);

      // board bg
      ctx.fillStyle = "#0f1722";
      ctx.fillRect(PADDING,PADDING,BOARD_SIZE,BOARD_SIZE);

      // grid + ice
      for (let r=0;r<GRID;r++){
        for (let c=0;c<GRID;c++){
          ctx.strokeStyle = "rgba(232,238,246,0.08)";
          ctx.lineWidth = 1;
          ctx.strokeRect(PADDING + c*CELL, PADDING + r*CELL, CELL, CELL);

          if (ice[r][c] === 1) {
            const x = PADDING + c*CELL;
            const y = PADDING + r*CELL;
            ctx.fillStyle = "rgba(180, 210, 255, 0.22)";
            ctx.fillRect(x, y, CELL, CELL);
            ctx.strokeStyle = "rgba(220, 240, 255, 0.55)";
            ctx.lineWidth = 2;
            ctx.strokeRect(x+4,y+4,CELL-8,CELL-8);
          }
        }
      }

      // pieces
      for (let r=0;r<GRID;r++){
        for (let c=0;c<GRID;c++){
          const t = pieces[r][c];
          const {x,y} = xyFromCell(r,c);
          const radius = CELL*0.33;
          ctx.fillStyle = COLORS[t];
          ctx.beginPath();
          ctx.arc(x,y,radius,0,Math.PI*2);
          ctx.fill();
        }
      }
    }

    function applyLevel(i) {
      levelIndex = Math.max(0, Math.min(i, LEVELS.length-1));
      const L = LEVELS[levelIndex];
      movesLeft = L.moves;
      targetScore = L.targetScore;
      objectives = { collect: { ...(L.collect||{}) }, iceLeft: Number(L.ice||0) };
      buildBoard();
      updateHUD(`Niveau ${levelIndex+1}`);
    }

    // modal (simple)
    const hideWin = () => el.winModal.classList.add("hidden");
    hideWin();

    el.newGame.addEventListener("click", () => applyLevel(levelIndex));
    el.winRestart.addEventListener("click", () => { hideWin(); applyLevel(levelIndex); });
    el.winNext.addEventListener("click", () => { hideWin(); applyLevel(levelIndex+1); });

    applyLevel(0);

    function tick() {
      draw();
      requestAnimationFrame(tick);
    }
    tick();

  } catch (err) {
    showBootError(err);
  }
})();