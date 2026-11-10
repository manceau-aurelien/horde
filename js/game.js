'use strict';
/* HORDE — boucle principale, synchronisation réseau (hôte ↔ invité) et façade Game. */

/* ---------------- Synchronisation : hôte ---------------- */
const PF = ['hp', 'maxHp', 'energy', 'reviveT', 'invuln', 'grenades', 'atkT', 'pushCd', 'stasisCd', 'stasisT', 'stasisMax', 'ultCd', 'ultT', 'ultMax',
  'rollCd', 'adrenT', 'adrenCd', 'turretCd', 'nadeCd', 'souls', 'kills', 'fireT', 'attackCount'];
const r1 = v => Math.round(v * 10) / 10;
const SNAP_INTERVAL = 1 / 20;
// Zone envoyée à l'invité (demi-largeur, demi-hauteur) : un peu plus que son écran.
// L'invité ne montre une mort que dans la zone BURST, plus petite, pour ne pas confondre
// un zombie sorti de la zone avec un zombie tué.
const SEND_W = 1150, SEND_H = 860, BURST_W = 1070, BURST_H = 780;
// Au-delà de ce nombre, les zombies sont envoyés par lots tournants (1 lot par état) :
// une énorme horde ne sature plus la connexion.
const ZOMBIES_PER_SNAP = 320, MAX_LOTS = 4;
let snapT = 0, snapN = 0, heatSendT = 0, inputT = 0, inputN = 0, actionN = 0;

function resetSync() {
  snapT = snapN = heatSendT = inputT = inputN = actionN = 0;
  acc = 0; lastTick = performance.now();
  R.net = { latest: null, arrival: 0, clock: null, jitter: 0, delay: 0.075 };
}

function packPlayer(p) {
  const a = [r1(p.x), r1(p.y), Math.round(p.angle * 100) / 100, p.moving ? 1 : 0, p.dash ? 1 : 0, p.down ? 1 : 0, p.gone ? 1 : 0, WEAPON_ORDER.indexOf(p.weapon)];
  for (const f of PF) a.push(r1(p[f]));
  if (p.cls === 'soldier') for (const k of WEAPON_ORDER) a.push(p.ammo[k] === Infinity ? -1 : p.ammo[k]);
  return a;
}

function netHostTick(dt) {
  // La fin doit contenir les derniers gains avant l'événement « over », même si un état se perd.
  const ending = evq.some(ev => ev[0] === 'over');
  if (evq.length && !ending) { Net.send({ t: 'e', run: R.seed, ev: evq }); evq = []; }
  snapT -= dt;
  if (snapT > 1e-8 && !ending) return;
  snapT += SNAP_INTERVAL;
  const g = R.players[1];
  if (!g || g.gone) { evq = []; return; }
  // seuls les zombies proches de l'invité sont transmis
  const zs = R.zombies, close = [];
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (!z.dead && Math.abs(z.x - g.x) < SEND_W && Math.abs(z.y - g.y) < SEND_H) close.push(z);
  }
  const zk = Math.min(MAX_LOTS, Math.max(1, Math.ceil(close.length / ZOMBIES_PER_SNAP)));
  const zp = (snapN + 1) % zk;
  const part = zk > 1 ? close.filter(z => z.d.boss || (z.id & 0xffff) % zk === zp) : close;
  const buf = new ArrayBuffer(part.length * 9), dv = new DataView(buf);
  for (let i = 0; i < part.length; i++) {
    const z = part[i], o = i * 9;
    dv.setUint16(o, z.id & 0xffff);
    dv.setUint16(o + 2, clamp(z.x * 8, 0, 65535));
    dv.setUint16(o + 4, clamp(z.y * 8, 0, 65535));
    dv.setUint8(o + 6, ZKEYS.indexOf(z.type) | (z.variant << 3) | (z.stun > 0 ? 32 : 0) | (z.inStasis ? 64 : 0) | (z.burn > 0 ? 128 : 0));
    dv.setUint8(o + 7, clamp(Math.ceil(z.hp / z.maxHp * 255), 0, 255));
    dv.setUint8(o + 8, ((z.angle % TAU + TAU) % TAU) / TAU * 255);
  }
  const m = {
    t: 's', run: R.seed, n: ++snapN, ts: R.t, zk, zp,
    g: [r1(R.t), R.wave, R.phase === 'fight' ? 1 : 0, r1(R.breakT), r1(R.waveT), R.left, R.normalTotal, R.level, r1(R.xp), R.combo, r1(R.comboT), r1(R.furyT), R.kills, R.cleared],
    p: R.players.map(packPlayer),
    z: buf,
    tu: R.turrets.map(t => [Math.round(t.x), Math.round(t.y), Math.round(t.angle * 100) / 100, r1(t.t), r1(t.max), t.muzzle > 0 ? 1 : 0]),
    cr: R.crates.map(c => [Math.round(c.x), Math.round(c.y), c.big ? 1 : 0, r1(c.t)]),
  };
  heatSendT -= SNAP_INTERVAL;
  if (heatSendT <= 0) { heatSendT = 1; m.h = R.heat.buffer.slice(0); }
  if (ending) {
    Net.send(m);
    Net.send({ t: 'e', run: R.seed, ev: evq }); evq = [];
  } else Net.sendLatest(m);
}

function hostInput(m) {
  const p = R.players[1];
  if (!p || p.gone) return;
  const d = m.d;
  if (!Array.isArray(d) || d.length !== 8 || !d.every(Number.isFinite)) return;
  // Les actions restent fiables ; une action retardée ne rembobine pas la position.
  if (m.t === 'a' && m.a > (p.lastAction || 0)) {
    p.lastAction = m.a;
    if (Array.isArray(m.pr)) for (const k of m.pr) if (ACTIONS.includes(k)) p.input.pressed[k] = true;
  }
  if (!Number.isFinite(m.n) || m.n <= (p.lastInput || 0)) return;
  p.lastInput = m.n; p.inputAge = 0;
  if (!p.down) { p.x = clamp(d[0], 20, WORLD - 20); p.y = clamp(d[1], 20, WORLD - 20); World.collide(p, p.r); }
  p.angle = d[2]; p.aimX = d[3]; p.aimY = d[4];
  p.input.mx = d[5]; p.input.my = d[6];
  p.moving = !!(d[5] || d[6]);
  p.input.attack = !!d[7];
}

/* ---------------- Synchronisation : invité ---------------- */
let replaying = false;

// Retour visuel immédiat uniquement. Dégâts, munitions et projectiles restent décidés par l'hôte.
function consumeAttackPreview(p, kind) {
  if (!p.local || !p.previews) return false;
  const now = performance.now();
  p.previews = p.previews.filter(v => now - v.at < 1000);
  const i = p.previews.findIndex(v => v.kind === kind);
  if (i < 0) return false;
  p.previews.splice(i, 1);
  return true;
}

function previewAttack(p, dt) {
  p.previewT = Math.max(0, (p.previewT || 0) - dt);
  if (!p.input.attack || p.down || p.dash || p.previewT > 1e-8) return;
  const st = p.st;
  let kind;
  if (p.cls === 'samurai') {
    if (p.ultT > 0 || (R.furyT <= 0 && p.energy < st.swordCost)) return;
    const count = Math.max(p.previewCount || 0, p.attackCount) + 1;
    p.previewCount = count;
    const whirl = st.whirlEvery && count % st.whirlEvery === 0;
    FX.swing(p.id, p.angle, whirl ? TAU : st.swordArc, !!whirl, whirl ? 0.24 : 0.16);
    p.previewT = st.swordCd; kind = 'swing';
  } else {
    const k = p.weapon, w = st.weapons[k];
    if (!w.infinite && p.ammo[k] <= 0) return;
    p.previewT = 1 / (w.rate * (p.adrenT > 0 ? (st.adren.rateMult || 1.5) : 1));
    kind = k === 'launcher' ? 'shell' : k === 'flamer' ? 'flame' : 'shot';
    p.muzzle = 0.05; p.recoil = k === 'shotgun' ? 1.6 : 0.6;
    if (k === 'launcher') Sfx.thump();
    else if (k === 'flamer') Sfx.flame();
    else if (k === 'shotgun') Sfx.shotgun();
    else if (k === 'pistol') Sfx.shot();
    else Sfx.rifle();
  }
  const now = performance.now();
  p.previews = (p.previews || []).filter(v => now - v.at < 1000);
  p.previews.push({ kind, at: now });
}

// Horloge de rendu distincte de la simulation : petit tampon adaptatif, extrapolation bornée.
function snapshotClock(ts, zk = 1) {
  const net = R.net, now = performance.now() / 1000;
  if (net.latest !== null) {
    const variation = Math.abs((now - net.arrival) - (ts - net.latest));
    net.jitter += (Math.min(0.3, variation) - net.jitter) * 0.15;
  }
  // avec des lots tournants, chaque zombie n'est revu que tous les zk états : on affiche un peu plus tard
  net.delay = Math.max(clamp(0.075 + net.jitter * 2, 0.075, 0.16), 0.075 + (zk - 1) * SNAP_INTERVAL);
  net.latest = ts; net.arrival = now;
  if (net.clock === null || Math.abs(ts - net.clock) > 0.6) net.clock = ts - net.delay;
}

function sampleEntity(e, x, y, angle, ts) {
  const samples = e.samples || (e.samples = []);
  if (Math.hypot(x - e.x, y - e.y) > 220) { samples.length = 0; e.x = x; e.y = y; }
  samples.push({ x, y, angle, ts });
  if (samples.length > 12) samples.shift();
}

function interpolateEntity(e, time) {
  const s = e.samples;
  if (!s || !s.length || time === null) return;
  while (s.length > 2 && s[1].ts <= time) s.shift();
  let a = s[0], b = s[1] || a;
  const duration = b.ts - a.ts;
  // Au plus 80 ms de mouvement deviné, puis arrêt en cas de coupure.
  const f = duration > 0 ? clamp((time - a.ts) / duration, 0, 1 + Math.min(0.08 / duration, 1)) : 0;
  e.x = a.x + (b.x - a.x) * f; e.y = a.y + (b.y - a.y) * f;
  e.angle = a.angle + angDiff(b.angle, a.angle) * Math.min(f, 1);
}

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
  snapshotClock(m.ts, m.zk || 1);
  const g = m.g;
  R.t = m.ts; R.wave = g[1]; R.phase = g[2] ? 'fight' : 'break'; R.breakT = g[3]; R.waveT = g[4]; R.left = g[5]; R.normalTotal = g[6];
  R.level = Math.max(R.level, g[7]); R.dmgMult = levelDmg(R.level); R.xp = g[8]; R.combo = g[9]; R.comboBest = Math.max(R.comboBest, R.combo); R.comboT = g[10]; R.furyT = g[11]; R.kills = g[12];
  if (g[13] > R.cleared) { R.cleared = g[13]; hooks.onWaveClear && hooks.onWaveClear(R.cleared); }

  m.p.forEach((a, i) => {
    const p = R.players[i];
    if (!p) return;
    if (!p.local) { sampleEntity(p, a[0], a[1], a[2], m.ts); p.moving = !!a[3]; p.dashing = !!a[4]; }
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
    sampleEntity(z, x, y, ang, m.ts);
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
  const zk = m.zk || 1, zp = m.zp || 0;
  for (const z of R.zombies) {
    if (z.seen === m.n) continue;
    // zombie d'un autre lot : il sera mis à jour par l'un des prochains états
    if (zk > 1 && !z.d.boss && z.id % zk !== zp) { list.push(z); continue; }
    zmap.delete(z.id);
    if (Math.abs(z.x - me1.x) < BURST_W && Math.abs(z.y - me1.y) < BURST_H) { bloodBurst(z, true); if (z.d.boss) shake(14); }
  }
  R.zombies = list;
  R.turrets = m.tu.map(a => ({ x: a[0], y: a[1], angle: a[2], t: a[3], max: a[4], muzzle: a[5] ? 0.05 : 0 }));
  R.crates = m.cr.map(a => ({ x: a[0], y: a[1], big: !!a[2], t: a[3], r: 16 }));
  if (m.h) R.heat = new Uint8Array(m.h instanceof ArrayBuffer ? m.h : m.h.buffer.slice(m.h.byteOffset, m.h.byteOffset + m.h.byteLength));
}

function stepGuest(dt) {
  R.t += dt;
  const net = R.net;
  if (net.clock !== null) {
    const age = Math.max(0, performance.now() / 1000 - net.arrival);
    const target = net.latest + Math.min(age, 0.2) - net.delay;
    net.clock = Math.min(net.latest + 0.08, net.clock + dt * clamp(1 + (target - net.clock) * 4, 0.8, 1.2));
  }
  // La grille et les collisions utilisent les positions affichées de ce pas.
  for (const z of R.zombies) interpolateEntity(z, net.clock);
  const p = me();
  gridBuild();
  readLocalInput(p);
  const inp = p.input;
  previewAttack(p, dt);
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
    interpolateEntity(q, net.clock);
    if (q.moving) q.walkPhase += dt * q.st.speed / 22;
    q.dash = q.dashing ? (q.dash || { vx: Math.cos(q.angle) * 900, vy: Math.sin(q.angle) * 900, t: 1, hit: new Set() }) : null;
  }
  for (const z of R.zombies) {
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
  if (inputT <= 1e-8 || pr.length || inp.attack !== p.sentAttack) {
    inputT = 1 / 30;
    const msg = { t: 'i', run: R.seed, n: ++inputN, d: [r1(p.x), r1(p.y), Math.round(p.angle * 100) / 100, Math.round(p.aimX), Math.round(p.aimY), r1(inp.mx), r1(inp.my), inp.attack ? 1 : 0] };
    Net.sendLatest(msg);
    // Les pouvoirs ponctuels ne doivent pas disparaître avec un paquet de position.
    if (pr.length && Net.send({ ...msg, t: 'a', a: ++actionN, pr })) inp.pressed = {};
    p.sentAttack = inp.attack;
  }
}

function netMessage(m) {
  if (!R || !m || m.run !== R.seed) return;
  if ((m.t === 'i' || m.t === 'a') && R.mode === 'host') hostInput(m);
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
    if (R.mode === 'host' && evq.length) netHostTick(0);
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
