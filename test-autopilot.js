// Pilote automatique de test (non chargé par le jeu) : sert à mesurer l'équilibrage.
// Dans la console : const s = document.createElement('script'); s.src = 'test-autopilot.js'; document.head.appendChild(s);
// puis : await Auto.run('samurai', {}, 1, 30)
window.Auto = (() => {
  const zd = new Uint8Array(GW * GW), bd = new Uint8Array(GW * GW), par = new Int32Array(GW * GW), q = new Int32Array(GW * GW);
  const NB = [-1, 1, -GW, GW];

  function fields(p) {
    zd.fill(255);
    let h = 0, t = 0;
    for (const z of R.zombies) {
      const i = ((z.y / TILE) | 0) * GW + ((z.x / TILE) | 0);
      if (!World.solid[i] && zd[i]) { zd[i] = 0; q[t++] = i; }
    }
    while (h < t) {
      const i = q[h++], d = zd[i] + 1;
      if (d > 14) continue;
      for (const o of NB) { const n = i + o; if (!World.solid[n] && zd[n] > d) { zd[n] = d; q[t++] = n; } }
    }
    bd.fill(255);
    const s = ((p.y / TILE) | 0) * GW + ((p.x / TILE) | 0);
    h = 0; t = 0; bd[s] = 0; par[s] = -1; q[t++] = s;
    while (h < t) {
      const i = q[h++], d = bd[i] + 1;
      if (d > 60) continue;
      for (const o of NB) {
        const n = i + o;
        if (World.solid[n] || bd[n] <= d || zd[n] <= 1) continue;
        bd[n] = d; par[n] = i; q[t++] = n;
      }
    }
    return { s, n: t };
  }

  function stepToward(p, target, s) {
    // remonte le chemin jusqu'à 2 tuiles du joueur
    let i = target;
    if (bd[i] === 255) return null;
    while (bd[i] > 2 && par[i] >= 0) i = par[i];
    return { x: (i % GW + 0.5) * TILE, y: ((i / GW | 0) + 0.5) * TILE };
  }

  function think() {
    if (!R || R.over) return;
    const p = me(), st = p.st;
    const { s, n } = fields(p);
    let close = 0, mid = 0, nearest = null, ndist = 1e9;
    for (const z of R.zombies) {
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d < 115) close++;
      if (d < 240) mid++;
      if (d < ndist) { ndist = d; nearest = z; }
    }
    for (const b of R.bombs) if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + 40) close += 6;
    const sam = p.cls === 'samurai';
    const flee = sam ? (close >= 6 || (p.hp < p.maxHp * 0.4 && close >= 2)) : zd[s] <= 4 || close >= 1;
    let goal = null;
    if (flee) {
      let best = -1e9, bi = s;
      for (let k = 0; k < n; k++) {
        const i = q[k];
        if (bd[i] > 10) break;
        const sc = Math.min(zd[i], 14) * 3 - bd[i] * 0.4 + (World.roomT[i] ? 1 : 0);
        if (sc > best) { best = sc; bi = i; }
      }
      goal = stepToward(p, bi, s);
    } else {
      // rien d'urgent : relique, caisse, puis orbes ; le Rōnin va au contact
      const want = [];
      if (R.relic) want.push(R.relic);
      if (!sam) for (const c of R.crates) want.push(c);
      let bo = null, bod = 500;
      for (const o of R.orbs) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bod) { bod = d; bo = o; } }
      if (bo && (zd[s] > 6 || sam)) want.unshift(bo);
      if (sam && nearest && ndist < 420 && ndist > 50) want.unshift(nearest);
      for (const w of want) {
        const i = ((w.y / TILE) | 0) * GW + ((w.x / TILE) | 0);
        if (bd[i] !== 255) { goal = bd[i] <= 2 ? { x: w.x, y: w.y } : stepToward(p, i, s); break; }
      }
    }
    keys.KeyW = keys.KeyA = keys.KeyS = keys.KeyD = false;
    if (goal) {
      const dx = goal.x - p.x, dy = goal.y - p.y;
      if (dx > 7) keys.KeyD = true; else if (dx < -7) keys.KeyA = true;
      if (dy > 7) keys.KeyS = true; else if (dy < -7) keys.KeyW = true;
    }
    if (sam) {
      if (close >= 5 && p.energy > st.push.cost + st.swordCost * 2) virtualPress('secondary');
      if (st.stasis && mid >= 10 && p.stasisT <= 0 && p.energy > st.stasis.cost + st.swordCost * 2) virtualPress('special');
      if (st.ult && close >= 8 && p.energy > st.ult.cost) virtualPress('ultimate');
      if (st.dash && close >= 8 && p.hp < p.maxHp * 0.4) virtualPress('mobility');
    } else {
      if (st.grenades && mid >= 10 && p.grenades > 0 && Math.random() < 0.3) virtualPress('secondary');
      if (st.roll && close >= 4) virtualPress('mobility');
      if (st.adren && mid >= 12) virtualPress('special');
      if (st.turret && mid >= 8) virtualPress('ultimate');
    }
  }

  // Joue une partie complète en accéléré ; renvoie un résumé.
  function run(cls, levels, startWave = 1, maxMin = 30) {
    return new Promise(res => {
      const savedHooks = Object.assign({}, hooks), savedSettings = Object.assign({}, settings);
      let ended = null;
      Game.settings = { autoAim: true, autoAttack: true, dmgNumbers: false, shake: false };
      Game.hooks = { onEnd: s => { ended = s; }, onSouls: () => {}, onWaveClear: () => {}, onPause: () => {} };
      Game.newRun({ mode: 'solo', seed: (Math.random() * 1e9) | 0, startWave, players: [{ cls, levels }], me: 0 });
      mouse.inside = false;
      let frames = 0, maxZ = 0, worst = 0;
      const log = [];
      let lastWave = 0;
      const t0 = performance.now();
      const mc = new MessageChannel();
      const finish = () => {
        keys.KeyW = keys.KeyA = keys.KeyS = keys.KeyD = false;
        ended.log = log; ended.maxZ = maxZ; ended.msPerStep = Math.round((performance.now() - t0) / frames * 100) / 100; ended.worstMs = Math.round(worst);
        if (R) Game.quitRun();
        hooks = savedHooks; Game.settings = savedSettings;
        res(ended);
      };
      const chunk = () => {
        const c0 = performance.now();
        for (let i = 0; i < 400 && !ended && performance.now() - c0 < 40; i++) {
          if (frames % 8 === 0) think();
          const s0 = performance.now();
          Game.step(1 / 60); frames++;
          worst = Math.max(worst, performance.now() - s0);
          if (R) {
            maxZ = Math.max(maxZ, R.zombies.length);
            if (R.wave !== lastWave) { lastWave = R.wave; log.push(R.wave + '@' + Math.round(frames / 60) + 's L' + R.level + ' z' + R.zombies.length + ' hp' + Math.round(me().hp)); }
            if (frames > maxMin * 3600 && !ended) { ended = Game.summary(); ended.timeout = true; }
          }
        }
        if (ended) finish(); else mc.port2.postMessage(0);
      };
      mc.port1.onmessage = chunk;
      chunk();
    });
  }
  return { run, think };
})();

// Carrière : enchaîne les parties en dépensant les âmes (toujours la compétence la moins chère).
Auto.career = async function (cls, runs, levels = {}, souls = 0) {
  const out = [];
  const T = TREES[cls];
  for (let r = 0; r < runs; r++) {
    const res = await Auto.run(cls, levels, 1, 40);
    souls += res.souls;
    let bought = 0;
    for (;;) {
      let best = null, bc = 1e18;
      for (const n of T.nodes) {
        const l = levels[n.id] || 0;
        if (l >= n.max || (n.req && !n.req.every(([id, rl]) => (levels[id] || 0) >= rl))) continue;
        const c = nodeCost(n, l);
        if (c < bc) { bc = c; best = n; }
      }
      if (!best || bc > souls) break;
      souls -= bc; levels[best.id] = (levels[best.id] || 0) + 1; bought++;
    }
    out.push('#' + (r + 1) + ' v' + res.wave + ' ' + Math.round(res.time) + 's k' + res.kills + ' +' + res.souls + ' L' + res.level + ' maxZ' + res.maxZ + ' ' + res.msPerStep + 'ms' + (res.timeout ? ' TIMEOUT' : '') + ' achats' + bought);
    window.__career = out;
  }
  return { out, levels, souls };
};
