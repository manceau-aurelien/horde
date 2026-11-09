'use strict';
/* HORDE — socle du moteur : état partagé, entrées, grille spatiale, effets visuels et sonores.
   Les fichiers engine / sim / render / game partagent la même portée globale. */

const TAU = Math.PI * 2;
const CELL = 64;
const GN = Math.ceil(WORLD / CELL) + 2;
const ALIVE_CAP = 1500;

let canvas, ctx, VW = 800, VH = 600, dpr = 1, zoom = 1;
let R = null;              // partie en cours
let paused = false;        // pause réelle (solo uniquement)
let menuOpen = false;      // menu ouvert en coop (la partie continue)
let settings = { dmgNumbers: true, autoAim: false, autoAttack: false, shake: true };
let hooks = {};
let touchMode = false;
let bigMap = false;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const me = () => R.players[R.me];
const alivePlayers = () => R.players.filter(p => !p.down && !p.gone);

/* ---------------- Entrées ---------------- */
const keys = {};
const pressed = {};      // actions déclenchées une fois
const held = {};         // actions maintenues (tactile)
const mouse = { x: 0, y: 0, left: false, inside: false };
const sticks = { move: null, aim: null };
const ACTIONS = ['secondary', 'mobility', 'special', 'ultimate', 'swap', 'swapPrev', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5'];

const KEYMAP = {
  KeyE: 'secondary', Space: 'mobility', ShiftLeft: 'mobility', KeyF: 'special', KeyR: 'ultimate',
  Digit1: 'w0', Digit2: 'w1', Digit3: 'w2', Digit4: 'w3', Digit5: 'w4', Digit6: 'w5',
  Numpad1: 'w0', Numpad2: 'w1', Numpad3: 'w2', Numpad4: 'w3', Numpad5: 'w4', Numpad6: 'w5',
  KeyQ: 'swap',
};

function minimapRect() {
  const small = VW < 700, s = small ? 0.85 : 1;
  const ms = small ? 104 : 168;
  return { x: VW - ms - 14, y: 60 * s, s: ms };
}

function bindInput() {
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' || e.code === 'KeyP') { if (R && !R.over) { togglePause(); e.preventDefault(); } return; }
    if (e.code === 'KeyM') { hooks.onMute && hooks.onMute(); return; }
    if (!R || paused || menuOpen) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Tab' && !keys.Tab) bigMap = !bigMap;
    if (!keys[e.code] && KEYMAP[e.code]) pressed[KEYMAP[e.code]] = true;
    keys[e.code] = true;
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = false; });

  canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; });
  canvas.addEventListener('mousedown', e => {
    Sfx.init();
    if (touchMode && !e.sourceCapabilities?.firesTouchEvents) setTouchMode(false);
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) pressed.secondary = true;
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouse.left = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    if (!R || paused) return;
    e.preventDefault();
    pressed[e.deltaY > 0 ? 'swap' : 'swapPrev'] = true;
  }, { passive: false });

  const tstart = e => {
    Sfx.init();
    if (!touchMode) setTouchMode(true);
    for (const t of e.changedTouches) {
      const m = minimapRect();
      if (bigMap || (t.clientX > m.x && t.clientY > m.y && t.clientY < m.y + m.s)) { bigMap = !bigMap; continue; }
      if (t.clientX < VW * 0.5) {
        if (!sticks.move) sticks.move = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      } else if (!sticks.aim) {
        sticks.aim = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  };
  const tmove = e => {
    for (const t of e.changedTouches) {
      for (const k of ['move', 'aim']) {
        const s = sticks[k];
        if (s && s.id === t.identifier) {
          s.x = t.clientX; s.y = t.clientY;
          const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), M = 70;
          if (d > M) { s.ox = s.x - dx / d * M; s.oy = s.y - dy / d * M; }
        }
      }
    }
    e.preventDefault();
  };
  const tend = e => {
    for (const t of e.changedTouches) {
      for (const k of ['move', 'aim']) if (sticks[k] && sticks[k].id === t.identifier) sticks[k] = null;
    }
  };
  canvas.addEventListener('touchstart', tstart, { passive: false });
  canvas.addEventListener('touchmove', tmove, { passive: false });
  canvas.addEventListener('touchend', tend);
  canvas.addEventListener('touchcancel', tend);
}

function setTouchMode(on) {
  touchMode = on;
  hooks.onTouchMode && hooks.onTouchMode(on);
}
function virtualPress(action) { pressed[action] = true; }
function virtualHold(action, on) { held[action] = on; }

function moveInput() {
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (sticks.move) {
    const dx = sticks.move.x - sticks.move.ox, dy = sticks.move.y - sticks.move.oy;
    const d = Math.hypot(dx, dy);
    if (d > 8) { mx = dx / Math.max(d, 60); my = dy / Math.max(d, 60); }
  }
  const l = Math.hypot(mx, my);
  if (l > 1) { mx /= l; my /= l; }
  return { mx, my };
}

/* ---------------- Grille spatiale (zombies) ---------------- */
const grid = Array.from({ length: GN * GN }, () => []);
const usedCells = [];
function gridClear() {
  for (const c of usedCells) c.length = 0;
  usedCells.length = 0;
}
function gridBuild() {
  gridClear();
  const zs = R.zombies;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead) continue;
    const cx = clamp((z.x / CELL) | 0, 0, GN - 1), cy = clamp((z.y / CELL) | 0, 0, GN - 1);
    const c = grid[cy * GN + cx];
    if (!c.length) usedCells.push(c);
    c.push(z);
  }
}
function near(x, y, r, fn) {
  const x0 = clamp(((x - r) / CELL) | 0, 0, GN - 1), x1 = clamp(((x + r) / CELL) | 0, 0, GN - 1);
  const y0 = clamp(((y - r) / CELL) | 0, 0, GN - 1), y1 = clamp(((y + r) / CELL) | 0, 0, GN - 1);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const c = grid[cy * GN + cx];
    for (let i = 0; i < c.length; i++) if (!c[i].dead) fn(c[i]);
  }
}

/* ---------------- Effets locaux ---------------- */
function particle(x, y, vx, vy, life, size, color, kind) {
  if (R.particles.length > 1600) return;
  R.particles.push({ x, y, vx, vy, life, max: life, size, color, kind: kind || 'dot' });
}
function addText(x, y, txt, color, scale = 1, dur = 0.8) {
  if (R.texts.length > 140) R.texts.shift();
  R.texts.push({ x, y, txt, color, scale, t: 0, dur });
}
function shake(v) { if (settings.shake && R) R.cam.shake = Math.min(18, Math.max(R.cam.shake, v)); }
// tremblement atténué par la distance au joueur local
function shakeAt(x, y, v) {
  const p = me();
  const d = Math.hypot(p.x - x, p.y - y);
  if (d < 900) shake(v * (1 - d / 900));
}
const audible = (x, y) => { const p = me(); return Math.abs(p.x - x) < 1000 && Math.abs(p.y - y) < 750; };
function splat(x, y) {
  for (let i = 0; i < 6; i++) particle(x, y, rand(-70, 70), rand(-70, 70), 0.35, rand(2, 4), null, 'goo');
}
function bloodBurst(z, big) {
  if (!audible(z.x, z.y)) return;
  R.decals.push({ x: z.x, y: z.y, r: z.r * rand(1.1, 1.8), rot: Math.random() * TAU, a: 0.75, kind: 'blood' });
  if (R.decals.length > 520) R.decals.splice(0, R.decals.length - 520);
  const n = big ? 8 : 4;
  for (let i = 0; i < n; i++) particle(z.x, z.y, rand(-140, 140), rand(-140, 140), rand(0.3, 0.6), rand(2, 4), '#5a0b0e', 'blood');
}

/* ---------------- Événements répliqués ----------------
   fx(nom, …args) joue l'effet tout de suite ; l'hôte le met aussi en file pour l'invité.
   Les arguments doivent rester de simples nombres / chaînes / tableaux. */
const FX = {};
let evq = [];
function fx(name, ...a) {
  FX[name](...a);
  if (R && R.mode === 'host') evq.push([name, ...a]);
}

FX.sfx = name => { Sfx[name] && Sfx[name](); };
FX.psfx = (pid, name) => {            // son réservé au joueur concerné
  const p = R.players[pid];
  if (!p || !p.local) return;
  if (name === 'empty') p.energyFlash = 0.4;
  Sfx[name] && Sfx[name]();
};
FX.banner = (text, sub, dur) => { R.banner = { text, sub, t: 0, dur: dur || 2.6 }; };
FX.text = (x, y, txt, color, scale, dur) => addText(x, y, txt, color, scale || 1, dur || 0.8);
FX.shake = v => shake(v);

FX.swing = (pid, angle, arc, whirl, dur) => {
  const p = R.players[pid];
  p.swingDir = -(p.swingDir || 1);
  p.swingT = dur; p.swingDur = dur; p.swingArc = arc; p.swingWhirl = !!whirl; p.swingAngle = angle;
  if (audible(p.x, p.y)) { if (whirl) Sfx.whirl(); else Sfx.slash(); }
};
FX.dash = (pid, x, y) => {
  const p = R.players[pid];
  if (replaying && p.local) return; // déjà joué localement
  if (audible(x, y)) Sfx.dash();
  if (p.cls === 'samurai') for (let i = 0; i < 10; i++) particle(x, y, rand(-40, 40), rand(-40, 40), 0.4, 3, 'rgba(160,220,255,0.6)');
};
FX.ring = (x, y, angle, arc, range, dur, color) => {
  R.fx.push({ kind: 'push', x, y, angle, arc, range, t: 0, dur, color: color || null });
};
FX.push = (x, y, angle, arc, range) => {
  FX.ring(x, y, angle, arc, range, 0.35, null);
  if (audible(x, y)) { Sfx.push(); shakeAt(x, y, 3); }
};
FX.stasis = pid => { if (audible(R.players[pid].x, R.players[pid].y)) Sfx.stasis(); };
FX.ult = pid => { const p = R.players[pid]; if (audible(p.x, p.y)) { Sfx.ult(); shakeAt(p.x, p.y, 4); } };

FX.shot = (pid, k, mx, my, arr) => {
  const p = R.players[pid], w = p.st.weapons[k];
  for (let i = 0; i < arr.length; i += 2) {
    const a = arr[i], sp = arr[i + 1];
    R.bullets.push({ kind: 'b', owner: pid, x: mx, y: my, px: p.x, py: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: k === 'shotgun' ? 3 : 2.5,
      dmg: w.dmg, pierce: w.pierce || 0, life: w.range / sp, hit: [], color: k === 'pistol' ? '#ffe9a0' : k === 'shotgun' ? '#ffcf70' : '#fff3c0' });
  }
  p.muzzle = 0.05; p.recoil = k === 'shotgun' ? 1.6 : 0.6;
  if (audible(p.x, p.y)) {
    if (k === 'shotgun') { Sfx.shotgun(); if (p.local) shake(2.5); }
    else if (k === 'pistol') Sfx.shot();
    else Sfx.rifle();
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    particle(p.x + -dy * 8, p.y + dx * 8, -dy * rand(60, 120) + rand(-20, 20), dx * rand(60, 120) + rand(-20, 20), 0.5, 1.6, '#d8b048', 'shell');
  }
};
FX.shell = (pid, mx, my, angle, life) => {
  const p = R.players[pid], w = p.st.weapons.launcher;
  R.bullets.push({ kind: 'shell', owner: pid, x: mx, y: my, px: p.x, py: p.y, vx: Math.cos(angle) * w.speed, vy: Math.sin(angle) * w.speed, r: 6,
    dmg: w.dmg, radius: w.radius, life, pierce: 0, hit: [] });
  p.muzzle = 0.08; p.recoil = 1;
  if (audible(p.x, p.y)) Sfx.thump();
};
FX.wave = (pid, x, y, angle) => {
  const p = R.players[pid], aw = p.st.airWave;
  R.bullets.push({ kind: 'wave', owner: pid, x, y, px: p.x, py: p.y, vx: Math.cos(angle) * 640, vy: Math.sin(angle) * 640,
    r: aw.big ? 32 : 22, dmg: p.st.swordDmg * aw.dmg, pierce: aw.pierce, life: aw.big ? 0.68 : 0.55, hit: [], angle });
};
FX.tshot = (pid, x, y, a) => {
  const p = R.players[pid];
  R.bullets.push({ kind: 'b', owner: pid, x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 18, px: x, py: y, vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000,
    r: 2.5, dmg: p.st.turret ? p.st.turret.dmg : 10, pierce: 0, life: 0.55, hit: [], color: '#9fe8ff', turret: true });
  if (audible(x, y)) Sfx.rifle();
};
FX.flame = (pid, mx, my, angle) => {
  const p = R.players[pid], w = p.st.weapons.flamer;
  if (!audible(p.x, p.y)) return;
  for (let i = 0; i < 2; i++) {
    const a = angle + rand(-w.arc / 2, w.arc / 2) * 0.8, sp = rand(w.range * 1.6, w.range * 2.6);
    particle(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.45), rand(5, 9), null, 'fire');
  }
  Sfx.flame();
};
FX.nade = (pid, sx, sy, tx, ty, dur, fuse, dmg, radius, frag, mini) => {
  R.grenades.push({ owner: pid, sx, sy, x: sx, y: sy, tx, ty, t: 0, dur, fuse, h: 0, dmg, radius, frag, mini: !!mini });
  if (!mini && audible(sx, sy)) Sfx.dash();
};
FX.bomb = (x, y, t, r, dmg) => { R.bombs.push({ x, y, t, max: t, r, dmg }); };
FX.spit = (x, y, vx, vy, dmg) => {
  R.eproj.push({ x, y, vx, vy, r: 7, dmg, life: 2.2, friendly: false });
  if (audible(x, y)) Sfx.spit();
};
FX.boom = (x, y, radius, friendly, scale) => {
  R.fx.push({ kind: 'boom', x, y, r: radius, t: 0, dur: 0.4, color: friendly ? null : '170,200,60' });
  if (!audible(x, y)) return;
  R.decals.push({ x, y, r: radius * 0.55, rot: Math.random() * TAU, a: 0.6, kind: friendly ? 'scorch' : 'goo' });
  const n = Math.round(14 * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(80, 320) * Math.sqrt(scale);
    particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), rand(4, 9) * Math.sqrt(scale), null, friendly ? 'fire' : 'goo');
  }
  for (let i = 0; i < 6 * scale; i++) particle(x, y, rand(-60, 60), rand(-60, 60), rand(0.8, 1.4), rand(10, 18), 'rgba(60,60,60,0.5)', 'smoke');
  Sfx.boom();
  shakeAt(x, y, friendly ? 5 * Math.sqrt(scale) : 6);
};
FX.slamwarn = (x, y, r, dur) => { R.fx.push({ kind: 'warn', x, y, r, t: 0, dur }); if (audible(x, y)) Sfx.groan(); };
FX.slam = (x, y, r) => {
  R.fx.push({ kind: 'boom', x, y, r, t: 0, dur: 0.5, color: '150,100,180' });
  if (audible(x, y)) { Sfx.boom(); shakeAt(x, y, 9); }
};
FX.orb = (id, kind, x, y, vx, vy, v) => { R.orbs.push({ id, kind, x, y, v, vx, vy, t: 0, life: kind === 'soul' ? 45 : 28 }); };
FX.pick = (id, pid, kind) => {
  const o = R.orbs.find(q => q.id === id);
  if (o) o.life = 0;
  if (R.players[pid].local) { if (kind === 'heal') Sfx.heal(); else Sfx.pickup(); }
};
FX.hurt = (pid, dmg) => {
  const p = R.players[pid];
  p.hurtT = 0.25;
  if (p.local) { Sfx.hurt(); shake(Math.min(8, 2 + dmg * 0.3)); }
};
FX.down = pid => {
  const p = R.players[pid];
  for (let i = 0; i < 24; i++) particle(p.x, p.y, rand(-180, 180), rand(-180, 180), rand(0.4, 0.9), rand(2, 5), '#7a0f12', 'blood');
  Sfx.death();
  R.banner = { text: p.local ? 'À TERRE !' : CLASSES[p.cls].name.toUpperCase() + ' EST À TERRE', sub: p.local ? 'Votre coéquipier peut vous relever' : 'Restez près de lui pour le relever', t: 0, dur: 3 };
};
FX.revive = pid => {
  const p = R.players[pid];
  FX.ring(p.x, p.y, 0, TAU, 160, 0.5, '120,255,150');
  Sfx.clear();
  addText(p.x, p.y - 30, 'RELEVÉ !', '#7dff8a', 1.3, 1.4);
};
FX.second = pid => {
  const p = R.players[pid];
  FX.ring(p.x, p.y, 0, TAU, 350, 0.55, '255,150,60');
  R.banner = { text: 'SECOND SOUFFLE', sub: '100 % PV', t: 0, dur: 2 };
  Sfx.push(); shakeAt(p.x, p.y, 10);
};
FX.levelup = level => {
  R.level = level;
  for (const p of R.players) {
    if (p.gone || p.down) continue;
    FX.ring(p.x, p.y, 0, TAU, 260, 0.6, '255,215,90');
    addText(p.x, p.y - 34, 'NIVEAU ' + level, '#ffd75a', 1.5, 1.6);
    for (let i = 0; i < 18; i++) { const a = Math.random() * TAU; particle(p.x, p.y, Math.cos(a) * rand(120, 300), Math.sin(a) * rand(120, 300), rand(0.4, 0.8), 3, '#ffd75a'); }
  }
  R.levelFlash = 1;
  Sfx.buy(); shake(5);
};
FX.combo = (n) => {
  const p = me();
  addText(p.x, p.y - 60, 'CARNAGE ×' + n, '#ff7a3a', 1.7, 1.6);
  Sfx.crate();
};
FX.relicSpawn = (x, y, kind) => { R.relic = { x, y, kind, t: 0 }; };
FX.relic = (kind, x, y, pid) => {
  R.relic = null;
  const names = { fury: ['FUREUR', 'Dégâts doublés, Ki et munitions gratuits'], nova: ['NOVA', 'La horde est balayée'], frost: ['GLACIATION', 'La horde est figée'] };
  R.banner = { text: names[kind][0], sub: names[kind][1], t: 0, dur: 2.6 };
  const col = kind === 'fury' ? '255,90,50' : kind === 'nova' ? '255,230,140' : '150,220,255';
  FX.ring(x, y, 0, TAU, kind === 'fury' ? 300 : 620, 0.8, col);
  for (let i = 0; i < 40; i++) { const a = Math.random() * TAU, sp = rand(150, 520); particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.9), rand(3, 6), 'rgb(' + col + ')'); }
  Sfx.ult(); Sfx.boom(); shake(12);
};
FX.shiftwarn = (open, close, dur) => {
  R.shift = { open, close, t: dur, max: dur };
  R.banner = { text: 'LE LABYRINTHE SE RECONFIGURE', sub: 'Des murs se lèvent, d\'autres tombent…', t: 0, dur: 3 };
  Sfx.wave();
};
FX.shift = (open, close) => {
  World.applyShift({ open, close });
  R.shift = null;
  for (const id of open.concat(close)) for (const t of World.linkTiles(id)) {
    const x = (t % GW + 0.5) * TILE, y = ((t / GW | 0) + 0.5) * TILE;
    if (!audible(x, y)) continue;
    for (let i = 0; i < 6; i++) particle(x + rand(-20, 20), y + rand(-20, 20), rand(-60, 60), rand(-60, 60), rand(0.6, 1.2), rand(10, 18), 'rgba(90,85,75,0.5)', 'smoke');
  }
  Sfx.boom(); shake(7);
  if (R.auth) afterShift();
};
FX.crateOpen = (x, y, msgs, pid) => {
  msgs.forEach((m, i) => addText(x, y - 20 - i * 16, m, '#ffd86a', 1.05, 1.4));
  if (audible(x, y)) Sfx.crate();
};
FX.over = () => {
  if (R.over) return;
  R.over = true; R.overT = 0;
  Sfx.death(); shake(12);
};
