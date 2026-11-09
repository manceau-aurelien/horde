// Pilote automatique de test (non chargé par le jeu). Coller dans la console.
window.Auto = (() => {
  const press = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code }));
  let cur = {};
  function setKeys(want) {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) if (!!want[c] !== !!cur[c]) press(c, !!want[c]);
    cur = want;
  }
  function think() {
    const R = Game.R; if (!R) return;
    const p = R.p;
    let fx = 0, fy = 0, close = 0, mid = 0;
    for (const z of R.zombies) {
      const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
      if (d < 320) { fx += dx / d / (d * d) * 1e4; fy += dy / d / (d * d) * 1e4; }
      if (d < 110) close++;
      if (d < 220) mid++;
    }
    const C = Game.ARENA / 2;
    fx += (C - p.x) / C * 0.4; fy += (C - p.y) / C * 0.4;
    if (R.cls === 'soldier' && R.crates.length && close < 3) {
      let best = null, bd = 1e9;
      for (const c of R.crates) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } }
      if (best && bd < 900) { fx += (best.x - p.x) / bd * 1.2; fy += (best.y - p.y) / bd * 1.2; }
    }
    if (R.cls === 'samurai' && close < 4) {
      let best = null, bd = 1e9;
      for (const z of R.zombies) { const d = Math.hypot(z.x - p.x, z.y - p.y); if (d < bd) { bd = d; best = z; } }
      if (best && bd > 60) { fx = (best.x - p.x) / bd; fy = (best.y - p.y) / bd; }
    }
    for (const b of R.bombs || []) { const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1; if (d < b.r + 30) { fx += dx / d * 3; fy += dy / d * 3; } }
    // tourne un peu autour pour éviter de rester bloqué
    const tx = -fy * 0.35, ty = fx * 0.35; fx += tx; fy += ty;
    const want = {};
    const l = Math.hypot(fx, fy);
    if (l > 0.15) {
      const a = Math.atan2(fy, fx), oct = Math.round(a / (Math.PI / 4));
      const dirs = { 0: 'D', 1: 'DS', 2: 'S', 3: 'SA', 4: 'A', '-4': 'A', '-3': 'AW', '-2': 'W', '-1: ': '', '-1': 'WD' };
      for (const ch of dirs[oct] || '') want['Key' + ch] = true;
    }
    setKeys(want);
    if (R.cls === 'samurai') {
      const st = R.st;
      if (close >= 5 && p.energy > st.push.cost + st.swordCost * 2) Game.virtualPress('secondary');
      if (st.stasis && mid >= 10 && p.stasisT <= 0 && p.energy > st.stasis.cost + st.swordCost * 2) Game.virtualPress('special');
      if (st.ult && close >= 8 && p.energy > st.ult.cost) Game.virtualPress('ultimate');
      if (st.dash && close >= 8 && p.hp < st.maxHp * 0.4) Game.virtualPress('mobility');
    } else {
      const st = R.st;
      if (st.grenades && mid >= 10 && p.grenades > 0 && Math.random() < 0.3) Game.virtualPress('secondary');
      if (st.roll && close >= 6) Game.virtualPress('mobility');
      if (st.adren && mid >= 12) Game.virtualPress('special');
      if (st.turret && mid >= 8) Game.virtualPress('ultimate');
    }
  }
  // joue une partie complète ; renvoie un résumé
  function run(cls, levels, startWave = 1, maxMin = 40) {
    return new Promise(res => {
      Game.settings = { autoAim: true, autoAttack: true, dmgNumbers: false, shake: false };
      let ended = null;
      Game.hooks = { onEnd: s => { ended = s; }, onSouls: () => {} };
      Game.newRun(cls, levels, startWave, {});
      Game.hooks = { onEnd: s => { ended = s; }, onSouls: () => {}, onWaveClear: () => {}, onPause: () => {} };
      let frames = 0;
      const log = [];
      let lastWave = 0, lastWaveF = 0;
      const mc = new MessageChannel();
      const chunk = () => {
        for (let i = 0; i < 240 && !ended; i++) {
          if (frames % 12 === 0) think();
          Game.step(1 / 60); frames++;
          const R = Game.R;
          if (R && R.wave !== lastWave) { lastWave = R.wave; lastWaveF = frames; log.push([R.wave, Math.round(frames / 60)]); }
          if (R && frames - lastWaveF > 420 * 60 && !ended) {
            ended = { stuck: true, wave: R.wave, kills: R.kills, souls: Math.round(R.souls), time: R.t, phase: R.phase, spawned: R.spawned, normalTotal: R.normalTotal,
              bosses: R.bossesPending, p: [Math.round(R.p.x), Math.round(R.p.y)],
              zs: R.zombies.slice(0, 8).map(z => ({ t: z.type, x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, dead: z.dead, sf: z.slowF, st: z.stun, kb: [z.kbx, z.kby] })) };
          }
          if (frames > maxMin * 3600) { ended = { timeout: true, wave: R.wave, kills: R.kills, souls: Math.round(R.souls), time: R.t }; }
        }
        if (ended) { setKeys({}); const R = Game.R; ended.log = log; if (R) ended.souls = Math.round(R.souls); Game.quitRun(); res(ended); }
        else mc.port2.postMessage(0);
      };
      mc.port1.onmessage = chunk;
      chunk();
    });
  }
  return { run, think };
})();
