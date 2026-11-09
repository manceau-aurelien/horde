'use strict';
/* HORDE — boucle principale, synchronisation réseau (hôte ↔ invité) et façade Game. */

/* ---------------- Synchronisation : hôte ---------------- */
const PF = ['hp', 'maxHp', 'energy', 'reviveT', 'invuln', 'grenades', 'atkT', 'pushCd', 'stasisCd', 'stasisT', 'stasisMax', 'ultCd', 'ultT', 'ultMax',
  'rollCd', 'adrenT', 'adrenCd', 'turretCd', 'nadeCd', 'souls', 'kills'];
const r1 = v => Math.round(v * 10) / 10;
let snapT = 0, snapN = 0, heatSendT = 0, inputT = 0;

function packPlayer(p) {
  const a = [r1(p.x), r1(p.y), Math.round(p.angle * 100) / 100, p.moving ? 1 : 0, p.dash ? 1 : 0, p.down ? 1 : 0, p.gone ? 1 : 0, WEAPON_ORDER.indexOf(p.weapon)];
  for (const f of PF) a.push(r1(p[f]));
  if (p.cls === 'soldier') for (const k of WEAPON_ORDER) a.push(p.ammo[k] === Infinity ? -1 : p.ammo[k]);
  return a;
}

function netHostTick(dt) {
  if (evq.length) { Net.send({ t: 'e', ev: evq }); evq = []; }
  snapT -= dt;
  if (snapT > 0) return;
  snapT = 1 / 15;
  const g = R.players[1];
  if (!g || g.gone) return;
  // seuls les zombies proches de l'invité sont transmis
  const zs = R.zombies, close = [];
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (!z.dead && Math.abs(z.x - g.x) < 1300 && Math.abs(z.y - g.y) < 980) close.push(z);
  }
  const buf = new ArrayBuffer(close.length * 9), dv = new DataView(buf);
  for (let i = 0; i < close.length; i++) {
    const z = close[i], o = i * 9;
    dv.setUint16(o, z.id & 0xffff);
    dv.setUint16(o + 2, clamp(z.x * 8, 0, 65535));
    dv.setUint16(o + 4, clamp(z.y * 8, 0, 65535));
    dv.setUint8(o + 6, ZKEYS.indexOf(z.type) | (z.variant << 3) | (z.stun > 0 ? 32 : 0) | (z.inStasis ? 64 : 0) | (z.burn > 0 ? 128 : 0));
    dv.setUint8(o + 7, clamp(Math.ceil(z.hp / z.maxHp * 255), 0, 255));
    dv.setUint8(o + 8, ((z.angle % TAU + TAU) % TAU) / TAU * 255);
  }
  const m = {
    t: 's', n: ++snapN,
    g: [r1(R.t), R.wave, R.phase === 'fight' ? 1 : 0, r1(R.breakT), r1(R.waveT), R.left, R.normalTotal, R.level, r1(R.xp), R.combo, r1(R.comboT), r1(R.furyT), R.kills, R.cleared],
    p: R.players.map(packPlayer),
    z: buf,
    tu: R.turrets.map(t => [Math.round(t.x), Math.round(t.y), Math.round(t.angle * 100) / 100, r1(t.t), r1(t.max), t.muzzle > 0 ? 1 : 0]),
    cr: R.crates.map(c => [Math.round(c.x), Math.round(c.y), c.big ? 1 : 0, r1(c.t)]),
  };
  heatSendT -= 1 / 15;
  if (heatSendT <= 0) { heatSendT = 1; m.h = R.heat.buffer.slice(0); }
  Net.send(m);
}

function hostInput(m) {
  const p = R.players[1];
  if (!p || p.gone) return;
  const d = m.d;
  if (!p.down) { p.x = clamp(d[0], 20, WORLD - 20); p.y = clamp(d[1], 20, WORLD - 20); World.collide(p, p.r); }
  p.angle = d[2]; p.aimX = d[3]; p.aimY = d[4];
  p.input.mx = d[5]; p.input.my = d[6];
  p.moving = !!(d[5] || d[6]);
  p.input.attack = !!d[7];
  if (m.pr) for (const k of m.pr) p.input.pressed[k] = true;
}

/* ---------------- Synchronisation : invité ---------------- */
let replaying = false;

function applyEvents(list) {
  replaying = true;
  for (const ev of list) {
    try { FX[ev[0]](...ev.slice(1)); } catch (e) { console.warn('événement', ev[0], e); }
  }
  replaying = false;
}

function applySnapshot(m) {
  if (m.n <= R.lastSnap) return;
  R.lastSnap = m.n;
  const g = m.g;
  R.t = g[0]; R.wave = g[1]; R.phase = g[2] ? 'fight' : 'break'; R.breakT = g[3]; R.waveT = g[4]; R.left = g[5]; R.normalTotal = g[6];
  R.level = g[7]; R.dmgMult = levelDmg(R.level); R.xp = g[8]; R.combo = g[9]; R.comboBest = Math.max(R.comboBest, R.combo); R.comboT = g[10]; R.furyT = g[11]; R.kills = g[12];
  if (g[13] > R.cleared) { R.cleared = g[13]; hooks.onWaveClear && hooks.onWaveClear(R.cleared); }

  m.p.forEach((a, i) => {
    const p = R.players[i];
    if (!p) return;
    if (!p.local) { p.tx = a[0]; p.ty = a[1]; p.tangle = a[2]; p.moving = !!a[3]; p.dashing = !!a[4]; }
    const wasDown = p.down;
    p.down = !!a[5]; p.gone = !!a[6];
    if (p.local && p.down && !wasDown) { p.dash = null; }
    p.weapon = WEAPON_ORDER[a[7]] || 'pistol';
    const oldSouls = p.souls;
    PF.forEach((f, k) => { p[f] = a[8 + k]; });
    if (p.local && p.souls > oldSouls) hooks.onSouls && hooks.onSouls(p.souls - oldSouls);
    if (p.cls === 'soldier') WEAPON_ORDER.forEach((k, j) => { const v = a[8 + PF.length + j]; p.ammo[k] = v < 0 ? Infinity : v; });
  });

  // zombies : interpolation entre deux instantanés ; un zombie qui disparaît à portée est mort
  const dv = new DataView(m.z instanceof ArrayBuffer ? m.z : m.z.buffer, m.z.byteOffset || 0, m.z.byteLength);
  const cnt = dv.byteLength / 9 | 0;
  const list = [], zmap = R.zmap, me1 = me();
  const hpScale = waveHpScale(Math.max(1, R.wave)) * 1.15;
  for (let i = 0; i < cnt; i++) {
    const o = i * 9, id = dv.getUint16(o);
    const x = dv.getUint16(o + 2) / 8, y = dv.getUint16(o + 4) / 8, f = dv.getUint8(o + 6);
    const hpf = dv.getUint8(o + 7) / 255, ang = dv.getUint8(o + 8) / 255 * TAU;
    let z = zmap.get(id);
    const type = ZKEYS[f & 7];
    if (!z || z.type !== type) {
      const d = ZTYPES[type];
      z = { id, type, d, x, y, r: d.r, variant: (f >> 3) & 3, angle: ang, hp: 0, maxHp: d.hp * hpScale, flash: 0, wob: Math.random() * TAU,
        stun: 0, inStasis: false, burn: 0, dead: false, spawnFade: 1, hpf };
      z.hp = hpf * z.maxHp;
      zmap.set(id, z);
    }
    z.px = z.x; z.py = z.y; z.tx = x; z.ty = y; z.lt = 0; z.ta = ang;
    if (Math.abs(x - z.x) > 220 || Math.abs(y - z.y) > 220) { z.x = z.px = x; z.y = z.py = y; } // téléporté
    if (hpf < z.hpf - 0.004) {
      z.flash = 0.08;
      if (audible(z.x, z.y)) {
        for (let k = 0; k < 2; k++) particle(z.x, z.y, rand(-90, 90), rand(-90, 90), 0.35, rand(2, 3.5), '#6a0f12', 'blood');
        if (settings.dmgNumbers) addText(z.x + rand(-8, 8), z.y - z.r, Math.max(1, Math.round((z.hpf - hpf) * z.maxHp)).toString(), '#ffffff', 1);
      }
    }
    z.hpf = hpf; z.hp = hpf * z.maxHp;
    z.stun = f & 32 ? 1 : 0; z.inStasis = !!(f & 64); z.burn = f & 128 ? 1 : 0;
    z.seen = m.n;
    list.push(z);
  }
  for (const z of R.zombies) {
    if (z.seen === m.n) continue;
    zmap.delete(z.id);
    if (Math.abs(z.x - me1.x) < 1150 && Math.abs(z.y - me1.y) < 830) { bloodBurst(z, true); if (z.d.boss) shake(14); }
  }
  R.zombies = list;
  R.turrets = m.tu.map(a => ({ x: a[0], y: a[1], angle: a[2], t: a[3], max: a[4], muzzle: a[5] ? 0.05 : 0 }));
  R.crates = m.cr.map(a => ({ x: a[0], y: a[1], big: !!a[2], t: a[3], r: 16 }));
  if (m.h) R.heat = new Uint8Array(m.h instanceof ArrayBuffer ? m.h : m.h.buffer.slice(m.h.byteOffset, m.h.byteOffset + m.h.byteLength));
}

function stepGuest(dt) {
  R.t += dt;
  const p = me();
  gridBuild();
  readLocalInput(p);
  const inp = p.input;
  if (inp.pressed.mobility && !tryDash(p)) delete inp.pressed.mobility;
  moveLocal(p, dt);
  if (p.dash) { p.dash.t -= dt; if (p.dash.t <= 0) p.dash = null; }
  // les zombies bousculent un peu le joueur
  if (!p.dash && !p.down) {
    near(p.x, p.y, 60, z => {
      const dx = z.x - p.x, dy = z.y - p.y, m = z.r + p.r, d = Math.hypot(dx, dy);
      if (d < m && d > 0.01) { p.x -= dx / d * (m - d) * 0.15; p.y -= dy / d * (m - d) * 0.15; }
    });
    World.collide(p, p.r);
  }
  for (const q of R.players) {
    tickVisual(q, dt);
    if (q.local) continue;
    q.x += (q.tx - q.x) * Math.min(1, dt * 18);
    q.y += (q.ty - q.y) * Math.min(1, dt * 18);
    if (q.tangle !== undefined) q.angle += angDiff(q.tangle, q.angle) * Math.min(1, dt * 20);
    if (q.moving) q.walkPhase += dt * q.st.speed / 22;
    q.dash = q.dashing ? (q.dash || { vx: Math.cos(q.angle) * 900, vy: Math.sin(q.angle) * 900, t: 1, hit: new Set() }) : null;
  }
  for (const z of R.zombies) {
    z.lt += dt;
    const f = Math.min(1, z.lt * 15);
    z.x = z.px + (z.tx - z.px) * f; z.y = z.py + (z.ty - z.py) * f;
    z.angle += angDiff(z.ta, z.angle) * Math.min(1, dt * 12);
    z.wob += dt * 6;
    if (z.flash > 0) z.flash -= dt;
    if (z.burn && Math.random() < 0.15 && audible(z.x, z.y)) particle(z.x + rand(-z.r, z.r) * 0.5, z.y + rand(-z.r, z.r) * 0.5, rand(-20, 20), rand(-40, -10), 0.4, rand(3, 6), null, 'fire');
  }
  updateBullets(dt);
  updatePickups(dt);
  updateFx(dt);
  if (R.phase === 'break') R.breakT -= dt; else R.waveT -= dt;
  // envoi des commandes : position, visée et actions
  inputT -= dt;
  const pr = Object.keys(inp.pressed);
  if (inputT <= 0 || pr.length) {
    inputT = 1 / 30;
    const msg = { t: 'i', d: [r1(p.x), r1(p.y), Math.round(p.angle * 100) / 100, Math.round(p.aimX), Math.round(p.aimY), r1(inp.mx), r1(inp.my), inp.attack ? 1 : 0] };
    if (pr.length) msg.pr = pr;
    Net.send(msg);
    inp.pressed = {};
  }
}

function netMessage(m) {
  if (!R || !m) return;
  if (m.t === 'i' && R.mode === 'host') hostInput(m);
  else if (R.mode === 'guest') {
    if (m.t === 's') applySnapshot(m);
    else if (m.t === 'e') applyEvents(m.ev);
  }
}

function peerLeft() {
  if (!R || R.over) return;
  if (R.mode === 'host') {
    const g = R.players[1];
    if (g && !g.gone) { g.gone = true; g.down = false; FX.banner('COÉQUIPIER DÉCONNECTÉ', 'Vous continuez seul', 3); }
  } else if (R.mode === 'guest') {
    FX.banner('CONNEXION PERDUE', 'Vos âmes sont conservées', 3);
    FX.over();
  }
}

/* ---------------- Boucle ---------------- */
function step(dt) {
  if (!R) return;
  if (R.over) {
    R.overT += dt;
    updateFx(dt * Math.max(0.15, 1 - R.overT));
    for (const z of R.zombies) z.wob += dt * 2;
    if (R.mode === 'host' && evq.length) { Net.send({ t: 'e', ev: evq }); evq = []; }
    if (R.overT > 1.8 && !R.endSent) {
      R.endSent = true;
      hooks.onEnd && hooks.onEnd(summary());
    }
    return;
  }
  if (R.mode === 'guest') stepGuest(dt);
  else {
    stepAuth(dt);
    if (R.mode === 'host') netHostTick(dt);
  }
}

let lastTick = 0, acc = 0;
function advance(now) {
  const dt = Math.min(0.25, (now - lastTick) / 1000 || 0);
  lastTick = now;
  if (!R || paused) return;
  acc += dt;
  let n = 0;
  while (acc >= 1 / 60 && n < 8) { step(1 / 60); acc -= 1 / 60; n++; }
  if (n >= 8) acc = 0;
}
function frame() {
  requestAnimationFrame(frame);
  advance(performance.now());
  if (R) render();
}
// En coop, la partie continue même si l'onglet passe en arrière-plan (sinon le coéquipier serait figé).
function startBackgroundTicker() {
  try {
    const src = 'setInterval(() => postMessage(0), 16);';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    // relais dès que l'affichage ne fait plus avancer la partie (onglet masqué, fenêtre réduite…)
    w.onmessage = () => { const now = performance.now(); if (R && R.coop && now - lastTick > 60) advance(now); };
  } catch (e) { /* pas de Worker : tant pis */ }
}

function togglePause(force) {
  if (!R || R.over) return;
  const want = force !== undefined ? force : !(paused || menuOpen);
  if (R.coop) menuOpen = want; else paused = want;
  mouse.left = false;
  for (const k in held) held[k] = false;
  hooks.onPause && hooks.onPause(want);
}

function quitRun() {
  if (!R) return null;
  const sum = summary();
  R = null;
  paused = false; menuOpen = false;
  return sum;
}

function initGame(cv) {
  canvas = cv;
  ctx = canvas.getContext('2d');
  Sprites.build();
  bindInput();
  window.addEventListener('resize', resize);
  resize();
  startBackgroundTicker();
  requestAnimationFrame(frame);
}

const Game = {
  init: initGame, newRun, step, render, resize, togglePause, quitRun, virtualPress, virtualHold, setTouchMode, netMessage, peerLeft, summary,
  get R() { return R; }, get paused() { return paused || menuOpen; }, get touchMode() { return touchMode; },
  set settings(v) { settings = Object.assign(settings, v); }, get settings() { return settings; },
  set hooks(v) { hooks = Object.assign(hooks, v); },
};
