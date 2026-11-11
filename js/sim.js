'use strict';
/* HORDE — simulation : partie, vagues, joueurs, zombies, projectiles, objets.
   Tout ce qui décide (dégâts, morts, butin) ne tourne que chez l'hôte (R.auth). */

/* ---------------- Création d'une partie ---------------- */
function blankInput() { return { mx: 0, my: 0, attack: false, pressed: {} }; }

function makePlayer(id, cls, levels, x, y, local) {
  const st = computeStats(cls, levels || {});
  const p = {
    id, cls, st, local, x, y, tx: x, ty: y, r: 15, angle: 0, hp: st.maxHp, maxHp: st.maxHp, energy: st.energyMax || 0,
    atkT: 0, attackCount: 0, swingT: 0, swingDir: 1, swingArc: 0, swingDur: 0.16, swingAngle: 0, swingWhirl: false,
    dash: null, invuln: 0, stasisT: 0, stasisMax: 1, stasisCd: 0, ultT: 0, ultMax: 1, ultCd: 0, ultTick: 0, pushCd: 0,
    hurtT: 0, secondUsed: false, energyFlash: 0, moving: false, walkPhase: 0,
    weapon: 'pistol', ammo: {}, grenades: 0, fireT: 0, muzzle: 0, rollCd: 0, adrenT: 0, adrenCd: 0, turretCd: 0, nadeCd: 0, recoil: 0,
    souls: 0, kills: 0, down: false, reviveT: 0, gone: false, input: blankInput(), aimX: x, aimY: y,
  };
  if (cls === 'soldier') {
    for (const k of WEAPON_ORDER) p.ammo[k] = st.weapons[k].infinite ? Infinity : st.weapons[k].start;
    p.grenades = st.grenades ? st.grenades.start : 0;
    p.weapon = bestWeapon(p);
  }
  return p;
}

/* cfg : { mode: 'solo' | 'host' | 'guest', seed, startWave, players: [{ cls, levels }], me } */
function newRun(cfg) {
  World.generate(cfg.seed);
  const c = World.rooms[0];
  const sw = Math.max(1, cfg.startWave | 0);
  R = {
    mode: cfg.mode, auth: cfg.mode !== 'guest', coop: cfg.players.length > 1, me: cfg.me | 0, seed: cfg.seed,
    t: 0, wave: sw - 1, phase: 'break', breakT: 4, waveT: 0, normalTotal: 0, spawned: 0, killedWave: 0, spawnT: 0,
    bossesPending: 0, bossT: 0, startWave: sw, cleared: sw - 1, carry: 0, left: 0,
    players: [], zombies: [], zmap: new Map(), bullets: [], eproj: [], particles: [], decals: [], orbs: [], crates: [], fx: [], texts: [],
    turrets: [], grenades: [], bombs: [],
    kills: 0, nextId: 1, crateT: 9, over: false, overT: 0, banner: null, hintT: 10,
    cam: { x: c.x, y: c.y, shake: 0 },
    level: 1, xp: 0, dmgMult: 1, levelFlash: 0, combo: 0, comboT: 0, comboBest: 0, furyT: 0,
    relic: null, relicT: 0, shift: null, lastSnap: 0, heat: new Uint8Array(MAZE_N * MAZE_N), heatT: 0, flowT: 0,
  };
  gridClear();
  cfg.players.forEach((pl, i) => {
    const off = cfg.players.length > 1 ? (i ? 46 : -46) : 0;
    R.players.push(makePlayer(i, pl.cls, pl.levels, c.x + off, c.y, i === R.me));
  });
  World.flow(R.players);
  paused = false; menuOpen = false; bigMap = false;
  evq = [];
  resetSync();
  for (const k in pressed) pressed[k] = false;
  resize();
  return R;
}

/* ---------------- Vagues ---------------- */
function startWave(n) {
  const np = R.players.filter(p => !p.gone).length;
  R.wave = n;
  R.phase = 'fight';
  R.normalTotal = waveTotal(n, np) + R.carry;
  R.carry = 0;
  R.spawned = 0;
  R.killedWave = 0;
  R.spawnT = 1.2;
  R.waveT = waveTimer(n);
  R.spawnRate = R.normalTotal / (R.waveT * 0.55);
  R.bossesPending = n % 10 === 0 ? n / 10 : 0;
  R.bossT = 6;
  fx('banner', 'VAGUE ' + n, R.bossesPending ? '⚠ Un Colosse approche…' : waveSub(n), 2.6);
  fx('sfx', 'wave');
  for (const p of R.players) {
    if (p.gone || p.cls !== 'soldier' || !p.st.waveDrop || n <= R.startWave) continue;
    for (let i = 0; i < p.st.waveDrop; i++) {
      const a = Math.random() * TAU;
      spawnCrate(p.x + Math.cos(a) * rand(70, 110), p.y + Math.sin(a) * rand(70, 110), p.st.waveDrop >= 3);
    }
  }
  if (n >= 2 && !R.relic && R.relicT <= 0) spawnRelic();
  if (n % 3 === 0) {
    const plan = World.planShift(8, alivePlayers());
    if (plan.open.length || plan.close.length) fx('shiftwarn', plan.open, plan.close, 3.5);
  }
  hooks.onWave && hooks.onWave(n);
}

function waveSub(n) {
  if (n === 1) return 'Ils arrivent de partout. Ne restez pas immobile.';
  if (n === 3) return 'Des meutes de Rampants !';
  if (n === 4) return 'Des coureurs arrivent !';
  if (n === 5) return 'Attention aux Gonflés : ils explosent.';
  if (n === 7) return 'Les Brutes encaissent beaucoup.';
  if (n === 9) return 'Les Cracheurs attaquent à distance.';
  return R.normalTotal + ' zombies';
}

function viewHalf() {
  return { hx: Math.max(VW / 2 / zoom, 780) + 70, hy: Math.max(VH / 2 / zoom, 480) + 70 };
}

// Tuile libre choisie par sa distance de marche au joueur le plus proche, hors de vue.
function tileByDist(dmin, dmax, hidden) {
  const { hx, hy } = viewHalf();
  const ps = alivePlayers();
  for (let tries = 0; tries < 60; tries++) {
    const tx = 1 + (Math.random() * (GW - 2)) | 0, ty = 1 + (Math.random() * (GW - 2)) | 0;
    const t = ty * GW + tx;
    if (World.solid[t]) continue;
    const d = World.dist[t];
    if (d < dmin || d > dmax) continue;
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (hidden && tries < 45 && ps.some(p => Math.abs(x - p.x) < hx && Math.abs(y - p.y) < hy && World.los(p.x, p.y, x, y))) continue;
    return { x, y };
  }
  return null;
}
function spawnPoint() {
  return tileByDist(11, 34, true) || tileByDist(8, 60, true) || tileByDist(5, 65000, false) || World.cellCenter(0, 0);
}

function spawnZombie(type, x, y) {
  const d = ZTYPES[type];
  const n = Math.max(1, R.wave);
  const hp = d.hp * waveHpScale(n) * (R.coop ? 1.15 : 1);
  const z = {
    id: R.nextId++, type, d, x, y, r: d.r, hp, maxHp: hp,
    speed: rand(d.speed[0], d.speed[1]) * (1 + Math.min(0.2, n * 0.005)),
    dmg: d.dmg * waveDmgScale(n), atkT: rand(0, 0.5), angle: 0, kbx: 0, kby: 0, stun: 0, slowF: 1,
    flash: 0, burn: 0, burnDps: 0, burnBy: null, variant: (Math.random() * 4) | 0, wob: Math.random() * TAU, dead: false,
    spitT: d.ranged ? rand(1, d.ranged.cd) : 0, inStasis: false, vuln: 0, slamT: d.boss ? 3 : 0, windup: 0, spawnFade: 0,
    ox: rand(-16, 16) * (d.r < 20 ? 1 : 0.3), oy: rand(-16, 16) * (d.r < 20 ? 1 : 0.3),
  };
  if ((R.nextId & 0xffff) === 0) R.nextId++;
  R.zombies.push(z);
  return z;
}

function spawnGroup() {
  const remaining = R.normalTotal - R.spawned;
  if (remaining <= 0) return 0;
  const pack = Math.random() < crawlerShare(R.wave);
  let size = Math.round(rand(5, 9 + R.wave * 0.7) * (pack ? 1.6 : 1));
  size = Math.min(remaining, size, 34, ALIVE_CAP - R.zombies.length);
  if (size <= 0) return 0;
  const c = spawnPoint();
  for (let i = 0; i < size; i++) {
    const z = spawnZombie(pack ? 'crawler' : pickZombieType(R.wave, Math.random()), c.x + rand(-60, 60), c.y + rand(-60, 60));
    World.collide(z, z.r);
    R.spawned++;
  }
  if (Math.random() < 0.3 && audible(c.x, c.y)) Sfx.groan();
  return size;
}

function updateWaves(dt) {
  if (R.phase === 'break') {
    R.breakT -= dt;
    if (R.breakT <= 0) startWave(R.wave + 1);
    return;
  }
  R.waveT -= dt;
  R.spawnT -= dt;
  if (R.spawnT <= 0 && R.spawned < R.normalTotal && R.zombies.length < ALIVE_CAP) {
    const n = spawnGroup();
    R.spawnT = Math.max(0.25, n / R.spawnRate);
  }
  if (R.bossesPending > 0) {
    R.bossT -= dt;
    if (R.bossT <= 0) {
      const c = spawnPoint();
      spawnZombie('boss', c.x, c.y);
      R.bossesPending--;
      R.bossT = 6;
      fx('sfx', 'groan'); fx('shake', 8);
    }
  }
  const allOut = R.spawned >= R.normalTotal && R.bossesPending === 0;
  const boss = R.zombies.some(z => z.d.boss);
  if (allOut && !boss && R.zombies.length <= Math.max(3, R.normalTotal * 0.04)) {
    // vague nettoyée : prime et courte accalmie
    const bonus = 4 + 3 * R.wave;
    gainSouls(bonus, true);
    R.cleared = R.wave;
    R.phase = 'break';
    R.breakT = 6;
    fx('banner', 'VAGUE ' + R.wave + ' NETTOYÉE', '+' + bonus + ' âmes', 3);
    fx('sfx', 'clear');
    hooks.onWaveClear && hooks.onWaveClear(R.wave);
  } else if (R.waveT <= 0) {
    // trop lent : la marée suivante déferle par-dessus la précédente
    R.carry = Math.max(0, R.normalTotal - R.spawned);
    R.cleared = R.wave;
    hooks.onWaveClear && hooks.onWaveClear(R.wave);
    startWave(R.wave + 1);
    fx('banner', 'LA MARÉE MONTE — VAGUE ' + R.wave, 'La horde précédente n\'a pas été contenue', 3);
  }
}

function gainSouls(n, flat) {
  const mult = flat ? 1 : 1 + Math.min(1, R.combo / 300);
  for (const p of R.players) {
    if (p.gone) continue;
    const v = n * p.st.soulMult * mult;
    p.souls += v;
    if (p.local) hooks.onSouls && hooks.onSouls(v);
  }
}

function gainXp(n) {
  R.xp += n;
  while (R.xp >= xpNeed(R.level)) {
    R.xp -= xpNeed(R.level);
    R.level++;
    R.dmgMult = levelDmg(R.level);
    for (const p of R.players) {
      if (p.gone) continue;
      const old = p.maxHp;
      p.maxHp = p.st.maxHp * levelHp(R.level);
      if (p.down) continue;
      p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - old) + p.maxHp * 0.12);
      near(p.x, p.y, 260, z => {
        const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d > 260) return;
        z.kbx += dx / d * 720 / z.d.mass; z.kby += dy / d * 720 / z.d.mass;
        if (!z.d.boss) z.stun = Math.max(z.stun, 0.7);
      });
    }
    fx('levelup', R.level);
  }
}

/* ---------------- Joueurs ---------------- */
function aimTarget(p) {
  if (p.aimTgt && !p.aimTgt.dead && R.t - p.aimTgtT < 0.12) return p.aimTgt;
  const maxR = 520, c = [];
  near(p.x, p.y, maxR, z => {
    const d = dist2(z.x, z.y, p.x, p.y);
    if (d < maxR * maxR) { z._d = d; c.push(z); }
  });
  c.sort((a, b) => a._d - b._d);
  let best = null;
  for (let i = 0; i < c.length && i < 14; i++) if (World.los(p.x, p.y, c[i].x, c[i].y)) { best = c[i]; break; }
  // On garde la cible précédente tant qu'elle reste presque aussi proche : moins de volte-face incessantes.
  const prev = p.aimTgt;
  if (best && prev && prev !== best && !prev.dead && (R.auth || R.zmap.get(prev.id) === prev)) {
    const dp = dist2(prev.x, prev.y, p.x, p.y);
    if (dp < maxR * maxR && dp < best._d * 1.6 && World.los(p.x, p.y, prev.x, prev.y)) best = prev;
  }
  p.aimTgt = best; p.aimTgtT = R.t;
  return best;
}

// Lit clavier / souris / tactile pour le joueur local.
function readLocalInput(p) {
  const inp = p.input;
  const m = menuOpen ? { mx: 0, my: 0 } : moveInput();
  inp.mx = m.mx; inp.my = m.my;
  let manualAim = false, attackHeld = false, target = null;
  if (sticks.aim) {
    const dx = sticks.aim.x - sticks.aim.ox, dy = sticks.aim.y - sticks.aim.oy;
    if (Math.hypot(dx, dy) > 12) { p.angle = Math.atan2(dy, dx); manualAim = true; }
    attackHeld = true;
  } else if (!touchMode && !settings.autoAim && mouse.inside) {
    const wx = (mouse.x - VW / 2) / zoom + R.cam.x, wy = (mouse.y - VH / 2) / zoom + R.cam.y;
    p.angle = Math.atan2(wy - p.y, wx - p.x);
    p.aimX = wx; p.aimY = wy;
    manualAim = true;
  }
  if (!manualAim) {
    target = aimTarget(p);
    if (target) {
      p.angle = Math.atan2(target.y - p.y, target.x - p.x);
      p.aimX = target.x; p.aimY = target.y;
    } else {
      if (m.mx || m.my) p.angle = Math.atan2(m.my, m.mx);
      p.aimX = p.x + Math.cos(p.angle) * 300; p.aimY = p.y + Math.sin(p.angle) * 300;
    }
  } else if (sticks.aim) {
    p.aimX = p.x + Math.cos(p.angle) * 300; p.aimY = p.y + Math.sin(p.angle) * 300;
  }
  if (mouse.left && !touchMode) attackHeld = true;
  if (held.attack) attackHeld = true;
  if ((touchMode || settings.autoAttack) && !sticks.aim) {
    const t = target || aimTarget(p);
    if (t) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (p.cls === 'samurai' ? d - t.r < p.st.swordRange * 1.05 : d < (p.st.weapons[p.weapon].range || 600) + 40) attackHeld = true;
    }
  }
  inp.attack = attackHeld && !menuOpen && !p.down;
  // Grenade en visée automatique : lancée sur le plus gros paquet de zombies à portée.
  if (pressed.secondary && !manualAim && !menuOpen && p.cls === 'soldier' && p.st.grenades && p.grenades > 0) {
    const spot = grenadeSpot(p, p.st.grenades.radius);
    if (spot) {
      p.nadeAim = { x: spot.x, y: spot.y, t: R.t };
      p.aimX = spot.x; p.aimY = spot.y;
      p.angle = Math.atan2(spot.y - p.y, spot.x - p.x);
    }
  }
  for (const k of ACTIONS) if (pressed[k]) { if (!menuOpen) inp.pressed[k] = true; pressed[k] = false; }
}

function useEnergy(p, cost) {
  if (R.furyT > 0) return true;
  if (p.energy < cost) { fx('psfx', p.id, 'empty'); return false; }
  p.energy -= cost;
  return true;
}

// Bond du Rōnin / roulade du Soldat. Lancé par le propriétaire du personnage et validé par l'hôte.
function tryDash(p) {
  const st = p.st, inp = p.input;
  if (p.dash || p.down) return false;
  let dur, dist, cut = 0, stun = 0, roll = false;
  if (p.cls === 'samurai') {
    if (!st.dash || !useEnergy(p, st.dash.cost)) return false;
    dur = 0.16; dist = st.dash.dist; cut = st.dash.cut; stun = st.dash.stun;
  } else {
    if (!st.roll || p.rollCd > 0) return false;
    p.rollCd = st.roll.cd;
    dur = 0.26; dist = st.roll.dist; roll = true;
  }
  let dx = inp.mx, dy = inp.my;
  if (!dx && !dy) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
  const l = Math.hypot(dx, dy); dx /= l; dy /= l;
  p.dash = { t: dur, vx: dx * dist / dur, vy: dy * dist / dur, cut, stun, roll, hit: new Set() };
  p.invuln = Math.max(p.invuln, dur + 0.08);
  fx('dash', p.id, p.x, p.y);
  return true;
}

function playerSpeed(p) {
  const st = p.st;
  let speed = st.speed * (R.furyT > 0 ? 1.15 : 1);
  if (p.cls === 'samurai' && p.ultT > 0) speed *= 1.08;
  if (p.cls === 'soldier') {
    if (p.adrenT > 0) speed *= st.adren.speedMult || 1.3;
    if (p.weapon === 'minigun' && (p.input.attack || p.fireT > 0)) speed *= st.weapons.minigun.slow;
  }
  return speed;
}

// Déplacement du personnage par la machine qui le contrôle.
function moveLocal(p, dt) {
  const inp = p.input;
  if (p.down) { p.moving = false; return; }
  p.moving = inp.mx !== 0 || inp.my !== 0;
  const speed = playerSpeed(p);
  if (p.dash) { p.x += p.dash.vx * dt; p.y += p.dash.vy * dt; }
  else { p.x += inp.mx * speed * dt; p.y += inp.my * speed * dt; }
  if (p.moving) p.walkPhase += dt * speed / 22;
  World.collide(p, p.r);
}

function tickVisual(p, dt) {
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.energyFlash = Math.max(0, p.energyFlash - dt);
  p.swingT = Math.max(0, p.swingT - dt);
  p.muzzle = Math.max(0, p.muzzle - dt);
  p.recoil = Math.max(0, p.recoil - dt * 8);
}

function updatePlayer(p, dt) {
  if (p.gone) return;
  const st = p.st, inp = p.input;
  if (!p.local) {
    p.inputAge = (p.inputAge || 0) + dt;
    // Une dernière touche « tirer » perdue ne doit pas tirer indéfiniment.
    if (p.inputAge > 0.25) { inp.attack = false; inp.mx = inp.my = 0; p.moving = false; }
  }
  tickVisual(p, dt);
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.down) {
    // un coéquipier debout à proximité relève le joueur à terre
    const helper = R.players.find(q => q !== p && !q.down && !q.gone && dist2(q.x, q.y, p.x, p.y) < 80 * 80);
    p.reviveT = helper ? p.reviveT + dt : Math.max(0, p.reviveT - dt * 0.5);
    if (p.reviveT >= 3) {
      p.down = false; p.reviveT = 0; p.hp = p.maxHp * 0.45; p.invuln = 2.5;
      near(p.x, p.y, 200, z => {
        const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
        z.kbx += dx / d * 600 / z.d.mass; z.kby += dy / d * 600 / z.d.mass; z.stun = Math.max(z.stun, 1);
      });
      fx('revive', p.id);
    }
    inp.pressed = {};
    return;
  }
  if (inp.pressed.mobility) tryDash(p);
  if (p.local) moveLocal(p, dt);
  else if (p.moving) p.walkPhase += dt * st.speed / 22;
  if (p.dash) {
    p.dash.t -= dt;
    if (p.dash.cut) dashCut(p);
    if (p.dash.t <= 0) p.dash = null;
  }
  if (st.regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + st.regen * dt);
  if (p.cls === 'samurai') updateSamurai(p, st, dt, inp);
  else updateSoldier(p, st, dt, inp);
  inp.pressed = {};
}

/* ----- Rōnin ----- */
function updateSamurai(p, st, dt, inp) {
  p.energy = Math.min(st.energyMax, p.energy + st.energyRegen * dt);
  p.atkT -= dt;
  if (inp.attack && p.atkT <= 0 && !p.dash && p.ultT <= 0) swing(p, st);

  p.pushCd = Math.max(0, p.pushCd - dt);
  if (inp.pressed.secondary && p.pushCd <= 0) push(p, st);
  p.stasisCd = Math.max(0, p.stasisCd - dt);
  if (inp.pressed.special && st.stasis && p.stasisT <= 0) {
    if (p.stasisCd > 0) fx('psfx', p.id, 'empty');
    else if (useEnergy(p, st.stasis.cost)) { p.stasisT = st.stasis.dur; p.stasisMax = st.stasis.dur; fx('stasis', p.id); }
  }
  p.ultCd = Math.max(0, p.ultCd - dt);
  if (inp.pressed.ultimate && st.ult && p.ultT <= 0) {
    if (p.ultCd > 0) fx('psfx', p.id, 'empty');
    else if (useEnergy(p, st.ult.cost)) { p.ultT = st.ult.dur; p.ultMax = st.ult.dur; p.ultTick = 0; fx('ult', p.id); }
  }

  if (p.stasisT > 0) {
    p.stasisT -= dt;
    if (p.stasisT <= 0) p.stasisCd = st.stasis.cd;
    if (st.stasis.drain) {
      let caught = 0;
      const rad = st.stasis.radius;
      near(p.x, p.y, rad + 40, z => { if (dist2(z.x, z.y, p.x, p.y) < (rad + z.r * 0.5) * (rad + z.r * 0.5)) caught++; });
      p.energy = Math.min(st.energyMax, p.energy + st.stasis.drain * Math.min(30, caught) * dt);
    }
  }

  // Tempête de lames
  if (p.ultT > 0) {
    p.ultT -= dt;
    if (p.ultT <= 0) p.ultCd = st.ult.cd || 8;
    const rad = st.ult.radius;
    p.ultTick -= dt;
    if (p.ultTick <= 0) {
      p.ultTick = 0.10;
      near(p.x, p.y, rad + 34, z => {
        const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d < rad + z.r && World.los(p.x, p.y, z.x, z.y)) {
          const nx = dx / d, ny = dy / d;
          const kb = (st.ult.kb * (1.15 - 0.35 * Math.min(1, d / rad))) / z.d.mass;
          const cur = Math.hypot(z.kbx, z.kby);
          z.kbx = nx * Math.max(cur, kb);
          z.kby = ny * Math.max(cur, kb);
          if (!z.d.boss) z.stun = Math.max(z.stun, 0.14);
          hitZombie(z, st.swordDmg * st.ult.mult, { canCrit: true, melee: true, silent: true, p });
        }
      });
      if (p.local && Math.random() < 0.45) Sfx.whirl();
    }
  }
}

function swing(p, st) {
  if (!useEnergy(p, st.swordCost)) { p.atkT = 0.16; return; }
  p.attackCount++;
  const whirl = st.whirlEvery && p.attackCount % st.whirlEvery === 0;
  const arc = whirl ? TAU : st.swordArc;
  const range = st.swordRange * (whirl ? 1.12 : 1);
  const mult = whirl ? (st.whirlMult || 1.25) : 1;
  p.atkT = st.swordCd;
  let hits = 0;
  near(p.x, p.y, range + 50, z => {
    const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
    if (d - z.r > range) return;
    if (!whirl && Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > arc / 2 + Math.atan2(z.r, Math.max(d, 1))) return;
    if (!World.los(p.x, p.y, z.x, z.y)) return;
    const kb = (whirl ? 180 : 115) / z.d.mass;
    hitZombie(z, st.swordDmg * mult, { kx: dx / (d || 1) * kb, ky: dy / (d || 1) * kb, canCrit: true, melee: true, p });
    hits++;
  });
  if (hits && st.leech) healPlayer(p, st.leech * Math.min(hits, st.leechCap || 4), false);
  fx('swing', p.id, p.angle, arc, whirl ? 1 : 0, whirl ? 0.24 : 0.16);
  // Renvoi des crachats
  if (st.deflect) {
    for (const b of R.eproj) {
      if (b.friendly) continue;
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d > range + 20) continue;
      if (!whirl && Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > arc / 2 + 0.3) continue;
      const sp = Math.hypot(b.vx, b.vy) * 1.9;
      let ra = p.angle;
      if (st.deflect >= 3) {
        const tgt = aimTarget(p);
        if (tgt) ra = Math.atan2(tgt.y - b.y, tgt.x - b.x);
      }
      b.life = 0;
      fx('deflect', p.id, b.x, b.y, Math.cos(ra) * sp, Math.sin(ra) * sp, st.swordDmg * (st.deflect >= 3 ? 7 : 2 + 1.5 * (st.deflect - 1)));
    }
  }
  if (st.airWave && !whirl) {
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    fx('wave', p.id, p.x + dx * 20, p.y + dy * 20, p.angle);
  }
}
FX.deflect = (pid, x, y, vx, vy, dmg) => {
  // le crachat d'origine disparaît près du sabre, un tir renvoyé prend sa place
  for (const b of R.eproj) if (!b.friendly && dist2(b.x, b.y, x, y) < 40 * 40) { b.life = 0; break; }
  R.eproj.push({ x, y, vx, vy, r: 7, dmg, life: 1.4, friendly: true, owner: pid });
  for (let i = 0; i < 5; i++) particle(x, y, rand(-80, 80), rand(-80, 80), 0.25, 2, '#bff');
};

function dashCut(p) {
  const st = p.st;
  near(p.x, p.y, 54, z => {
    if (p.dash.hit.has(z.id)) return;
    if (Math.hypot(z.x - p.x, z.y - p.y) < z.r + p.r + 16) {
      p.dash.hit.add(z.id);
      if (p.dash.stun) z.stun = Math.max(z.stun, p.dash.stun * (z.d.boss ? 0.4 : 1));
      hitZombie(z, st.swordDmg * p.dash.cut, { canCrit: true, melee: true, p });
    }
  });
}

function push(p, st) {
  const P = st.push;
  if (!useEnergy(p, P.cost)) return;
  p.pushCd = P.cd;
  const full = P.arc >= TAU - 0.01;
  near(p.x, p.y, P.range + 40, z => {
    const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (d - z.r > P.range) return;
    if (!full && Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > P.arc / 2 + 0.15) return;
    if (!World.los(p.x, p.y, z.x, z.y)) return;
    const f = P.force * (1 - 0.45 * d / P.range) / z.d.mass;
    z.kbx += dx / d * f; z.kby += dy / d * f;
    if (P.stun) z.stun = Math.max(z.stun, P.stun * (z.d.boss ? (P.stunBoss ? 0.6 : 0.3) : 1));
    hitZombie(z, P.dmg, { canCrit: false, p });
  });
  for (const b of R.eproj) {
    if (b.friendly) continue;
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
    if (d < P.range && (full || Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) < P.arc / 2 + 0.2)) { b.life = 0; fx('eprojKill', b.x, b.y); }
  }
  fx('push', p.x, p.y, p.angle, P.arc, P.range);
}
FX.eprojKill = (x, y) => {
  if (!R.auth) for (const b of R.eproj) if (!b.friendly && dist2(b.x, b.y, x, y) < 50 * 50) { b.life = 0; break; }
  for (let i = 0; i < 4; i++) particle(x, y, rand(-90, 90), rand(-90, 90), 0.22, 2, '#c8f4ff');
};

/* ----- Soldat ----- */
function bestWeapon(p) {
  for (let i = WEAPON_ORDER.length - 1; i >= 1; i--) {
    const k = WEAPON_ORDER[i];
    if (p.st.weapons[k].unlocked && p.ammo[k] > 0) return k;
  }
  return 'pistol';
}
function availableWeapons(p) { return WEAPON_ORDER.filter(k => p.st.weapons[k].unlocked); }
function cycleWeapon(p, dir) {
  const list = availableWeapons(p).filter(k => p.ammo[k] > 0);
  if (list.length < 2) return;
  let i = list.indexOf(p.weapon);
  i = (i + dir + list.length) % list.length;
  p.weapon = list[i];
  fx('psfx', p.id, 'click');
}

function updateSoldier(p, st, dt, inp) {
  p.fireT -= dt;
  p.rollCd = Math.max(0, p.rollCd - dt);
  p.adrenCd = Math.max(0, p.adrenCd - dt);
  p.turretCd = Math.max(0, p.turretCd - dt);
  p.nadeCd = Math.max(0, p.nadeCd - dt);
  p.adrenT = Math.max(0, p.adrenT - dt);

  for (let i = 0; i < 6; i++) {
    if (inp.pressed['w' + i]) {
      const k = WEAPON_ORDER[i];
      if (st.weapons[k].unlocked && p.ammo[k] > 0) { p.weapon = k; fx('psfx', p.id, 'click'); }
    }
  }
  if (inp.pressed.swap) cycleWeapon(p, 1);
  if (inp.pressed.swapPrev) cycleWeapon(p, -1);

  if (inp.attack && p.fireT <= 0 && !p.dash) fire(p, st, st.weapons[p.weapon]);

  if (inp.pressed.secondary && st.grenades && p.nadeCd <= 0) {
    if (p.grenades > 0) throwGrenade(p, st); else fx('psfx', p.id, 'empty');
  }
  if (inp.pressed.special && st.adren && p.adrenCd <= 0) {
    p.adrenT = st.adren.dur; p.adrenCd = st.adren.cd; fx('psfx', p.id, 'heal');
  }
  if (inp.pressed.ultimate && st.turret && p.turretCd <= 0) {
    const t = { owner: p.id, x: p.x + Math.cos(p.angle) * 30, y: p.y + Math.sin(p.angle) * 30, t: st.turret.dur, max: st.turret.dur, fireT: 0, angle: p.angle, muzzle: 0 };
    World.collide(t, 16);
    R.turrets.push(t);
    p.turretCd = st.turret.cd; fx('psfx', p.id, 'crate');
  }
}

function fire(p, st, w) {
  const k = p.weapon;
  if (!w.infinite && p.ammo[k] <= 0) { p.weapon = bestWeapon(p); return; }
  const rate = w.rate * (p.adrenT > 0 ? (st.adren.rateMult || 1.5) : 1);
  p.fireT = 1 / rate;
  const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  let mx = p.x + dx * 26 + -dy * 6, my = p.y + dy * 26 + dx * 6;
  if (World.solidAt(mx, my)) { mx = p.x + dx * 8; my = p.y + dy * 8; }
  if (k === 'flamer') {
    flameTick(p, w);
    fx('flame', p.id, mx, my, p.angle);
  } else if (k === 'launcher') {
    const d = Math.min(w.range, Math.max(80, Math.hypot(p.aimX - p.x, p.aimY - p.y)));
    fx('shell', p.id, mx, my, p.angle, d / w.speed);
  } else {
    const n = k === 'shotgun' ? w.pellets : w.count || 1;
    const arr = [];
    for (let i = 0; i < n; i++) {
      let a = p.angle;
      if (k === 'shotgun') a += (i / (n - 1) - 0.5) * w.spread + rand(-0.04, 0.04);
      else if (n > 1) a += (i - (n - 1) / 2) * 0.12 + rand(-w.spread, w.spread) * 0.5;
      else a += rand(-w.spread, w.spread);
      arr.push(Math.round(a * 1000) / 1000, Math.round(w.speed * (k === 'shotgun' ? rand(0.85, 1.1) : 1)));
    }
    fx('shot', p.id, k, mx, my, arr);
  }
  if (!w.infinite && R.furyT <= 0 && !(w.thrift && Math.random() < w.thrift)) {
    p.ammo[k]--;
    if (p.ammo[k] <= 0) { p.ammo[k] = 0; p.weapon = bestWeapon(p); fx('psfx', p.id, 'empty'); }
  }
}

function flameTick(p, w) {
  const range = w.range;
  near(p.x, p.y, range + 40, z => {
    const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
    if (d - z.r > range) return;
    if (Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > w.arc / 2 + Math.atan2(z.r, Math.max(d, 1))) return;
    if (!World.los(p.x, p.y, z.x, z.y)) return;
    hitZombie(z, w.dmg, { canCrit: false, silent: true, p });
    z.burn = 2.5; z.burnDps = Math.max(z.burnDps, w.burn * R.dmgMult); z.burnBy = p;
  });
}

// Visée automatique : point (à portée de lancer) qui touche le plus de zombies dans le rayon de la grenade.
const NADE_RANGE = 420;
function grenadeSpot(p, radius) {
  const c = [], minD = 70;
  near(p.x, p.y, NADE_RANGE + radius * 0.5, z => {
    const d = dist2(z.x, z.y, p.x, p.y);
    if (d < NADE_RANGE * NADE_RANGE && d > minD * minD) c.push(z);
  });
  if (!c.length) return null;
  const step = Math.max(1, Math.ceil(c.length / 90)), rr = radius * 0.8, r2 = rr * rr;
  let best = null, bestS = 0;
  for (let i = 0; i < c.length; i += step) {
    const a = c[i];
    let s = 0, sx = 0, sy = 0;
    near(a.x, a.y, rr, z => {
      if (dist2(z.x, z.y, a.x, a.y) > r2) return;
      const w = z.d && z.d.boss ? 6 : z.d && z.d.mass >= 4 ? 3 : 1;
      s += w; sx += z.x * w; sy += z.y * w;
    });
    // à nombre égal, on préfère le groupe le plus proche
    const score = s - Math.sqrt(dist2(a.x, a.y, p.x, p.y)) / NADE_RANGE * 0.5;
    if (s > 0 && score > bestS) { bestS = score; best = { x: sx / s, y: sy / s }; }
  }
  return best;
}

function throwGrenade(p, st) {
  p.grenades--;
  p.nadeCd = 0.35;
  if (p.nadeAim && R.t - p.nadeAim.t < 0.6) { p.aimX = p.nadeAim.x; p.aimY = p.nadeAim.y; }
  p.nadeAim = null;
  let dx = p.aimX - p.x, dy = p.aimY - p.y, d = Math.hypot(dx, dy);
  const maxD = NADE_RANGE;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  if (d < 60) { dx = Math.cos(p.angle) * 60; dy = Math.sin(p.angle) * 60; }
  // les grenades passent par-dessus les murs mais ne restent pas dedans
  const land = { x: p.x + dx, y: p.y + dy };
  World.collide(land, 8);
  fx('nade', p.id, p.x, p.y, land.x, land.y, 0.55, 0.45, st.grenades.dmg, st.grenades.radius, st.grenades.frag, 0);
}

/* ---------------- Dégâts ---------------- */
function hitZombie(z, dmg, o) {
  if (!R.auth || z.dead) return;
  const p = o.p || null, st = p ? p.st : null;
  let crit = false;
  if (!o.raw) dmg *= R.dmgMult * (R.furyT > 0 ? 2 : 1);
  if (o.canCrit && st && Math.random() < st.crit) { dmg *= st.critMult; crit = true; }
  if (z.vuln) dmg *= 1 + z.vuln;
  z.hp -= dmg;
  z.flash = 0.08;
  if (o.kx) { z.kbx += o.kx; z.kby += o.ky; }
  if (audible(z.x, z.y)) {
    if (!o.silent) {
      for (let i = 0; i < (crit ? 4 : 2); i++) particle(z.x, z.y, rand(-90, 90), rand(-90, 90), 0.35, rand(2, 3.5), '#6a0f12', 'blood');
      if (o.melee) Sfx.hit();
    }
    if (settings.dmgNumbers && (!o.silent || Math.random() < 0.12)) addText(z.x + rand(-8, 8), z.y - z.r, Math.round(dmg).toString(), crit ? '#ffd23a' : '#ffffff', crit ? 1.25 : 1);
  }
  if (st) {
    const execThresh = z.d.boss ? (st.executeBoss || 0) : (st.execute || 0);
    if (execThresh && z.hp > 0 && z.hp < z.maxHp * execThresh) z.hp = 0;
  }
  if (z.hp <= 0) killZombie(z, p);
}

const COMBO_STEPS = [25, 50, 100, 200, 400, 800, 1600, 3200];
function killZombie(z, p) {
  if (z.dead) return;
  z.dead = true;
  R.kills++;
  R.killedWave++;
  if (p) p.kills++;
  R.combo++; R.comboT = 3.5;
  if (R.combo > R.comboBest) R.comboBest = R.combo;
  if (COMBO_STEPS.includes(R.combo)) fx('combo', R.combo);
  const souls = z.d.souls;
  gainXp(z.d.xp);
  if (R.orbs.length > 320) gainSouls(souls);
  else dropOrb('soul', z.x, z.y, souls);
  const ref = p || R.players[0];
  if (Math.random() < ref.st.healChance || z.d.boss) dropOrb('heal', z.x, z.y, z.d.boss ? 60 : ref.st.healAmt);
  const sol = R.players.find(q => q.cls === 'soldier' && !q.gone);
  if (sol) {
    if (sol.st.scavenge && Math.random() < sol.st.scavenge && availableWeapons(sol).length > 1) dropOrb('ammo', z.x, z.y, 0.25);
    if (z.d.boss) for (let i = 0; i < 2; i++) spawnCrate(z.x + rand(-40, 40), z.y + rand(-40, 40), true);
  }
  if (p && p.st.energyOnKill) p.energy = Math.min(p.st.energyMax, p.energy + p.st.energyOnKill);
  bloodBurst(z, true);
  if (z.d.explode) fx('bomb', z.x, z.y, 0.55, z.d.explode.r, z.d.explode.dmg * waveDmgScale(R.wave));
  if (z.d.boss) { fx('shake', 14); fx('banner', 'COLOSSE ABATTU', '+' + Math.round(souls) + ' âmes', 2.5); }
}

function hurtPlayer(p, dmg, srcX, srcY) {
  if (!R.auth || R.over || p.down || p.gone || p.invuln > 0) return;
  const st = p.st;
  if (st.dodge && Math.random() < st.dodge) { fx('text', p.x, p.y - 26, 'ESQUIVE', '#9fe8ff', 1, 0.8); p.invuln = 0.15; return; }
  dmg *= st.dmgTaken;
  if (p.ultT > 0 && st.ult) dmg *= st.ult.dmgTakenMult || 0.4;
  p.hp -= dmg;
  fx('hurt', p.id, Math.round(dmg));
  if (p.local && srcX !== undefined) {
    const dx = p.x - srcX, dy = p.y - srcY, d = Math.hypot(dx, dy) || 1;
    p.x += dx / d * 4; p.y += dy / d * 4;
  }
  if (p.hp > 0) return;
  if (st.second && !p.secondUsed) {
    p.secondUsed = true;
    p.hp = p.maxHp;
    p.invuln = 2.4;
    near(p.x, p.y, 350, z => {
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
      z.kbx += dx / d * 1050 / z.d.mass; z.kby += dy / d * 1050 / z.d.mass; z.stun = Math.max(z.stun, 1.5);
    });
    fx('second', p.id);
    return;
  }
  p.hp = 0;
  if (R.players.some(q => q !== p && !q.down && !q.gone)) {
    p.down = true; p.reviveT = 0; p.dash = null;
    fx('down', p.id);
  } else gameOver();
}

function healPlayer(p, v, show = true) {
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + v);
  if (show && p.hp > before) fx('text', p.x, p.y - 28, '+' + Math.round(p.hp - before) + ' PV', '#7dff8a', 1, 0.8);
}

function explode(x, y, radius, dmg, friendly, scale, owner) {
  if (!R.auth) return;
  near(x, y, radius + 30, z => {
    const dx = z.x - x, dy = z.y - y, d = Math.hypot(dx, dy) || 1;
    if (d - z.r > radius || !World.los(x, y, z.x, z.y)) return;
    const f = 1 - 0.5 * Math.min(1, d / radius);
    hitZombie(z, dmg * f * (friendly ? 1 : 1.5), { kx: dx / d * 380 * f / z.d.mass, ky: dy / d * 380 * f / z.d.mass, canCrit: friendly, p: owner, raw: !friendly });
  });
  if (!friendly) {
    for (const p of R.players) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < radius + p.r && World.los(x, y, p.x, p.y)) hurtPlayer(p, dmg * (1 - 0.4 * d / radius), x, y);
    }
  }
  fx('boom', Math.round(x), Math.round(y), Math.round(radius), friendly ? 1 : 0, scale || 1);
}

/* ---------------- Zombies ---------------- */
function updateZombies(dt) {
  const zs = R.zombies;
  const ps = alivePlayers();
  for (let i = 0; i < zs.length; i++) { const z = zs[i]; z.slowF = 1; z.inStasis = false; z.vuln = 0; }
  gridBuild();
  for (const p of R.players) {
    if (p.cls !== 'samurai' || p.stasisT <= 0 || p.gone) continue;
    const S = p.st.stasis, rad = S.radius, fullStop = S.slow >= 1;
    near(p.x, p.y, rad + 40, z => {
      if (dist2(z.x, z.y, p.x, p.y) < (rad + z.r * 0.5) * (rad + z.r * 0.5)) {
        z.slowF = Math.min(z.slowF, 1 - S.slow * (z.d.boss ? (fullStop ? 0.85 : 0.6) : 1));
        z.inStasis = true; z.vuln = S.vuln;
      }
    });
  }
  const p0 = ps[0], p1 = ps[1];
  const dist = World.dist, nextT = World.nextT;
  const decay = Math.exp(-5 * dt);

  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead) continue;
    const sf = z.slowF, zdt = dt * sf;
    if (z.flash > 0) z.flash -= dt;
    if (z.spawnFade < 1) z.spawnFade = Math.min(1, z.spawnFade + dt * 2);
    if (z.burn > 0) {
      z.burn -= dt;
      z.hp -= z.burnDps * dt;
      if (Math.random() < 0.2 && audible(z.x, z.y)) particle(z.x + rand(-z.r, z.r) * 0.5, z.y + rand(-z.r, z.r) * 0.5, rand(-20, 20), rand(-40, -10), 0.4, rand(3, 6), null, 'fire');
      if (z.hp <= 0) { killZombie(z, z.burnBy); continue; }
      if (z.burn <= 0) z.burnDps = 0;
    }
    if (!p0) continue;
    // cible : le joueur debout le plus proche
    let p = p0, dx = p0.x - z.x, dy = p0.y - z.y, d2 = dx * dx + dy * dy;
    if (p1) {
      const ex = p1.x - z.x, ey = p1.y - z.y, e2 = ex * ex + ey * ey;
      if (e2 < d2) { p = p1; dx = ex; dy = ey; d2 = e2; }
    }
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d, ny = dy / d;
    if (sf > 0) z.wob += zdt * (z.speed / 12);
    if (z.stun > 0) z.stun -= dt;
    let vx = 0, vy = 0;
    if (z.stun <= 0) {
      let sp = z.speed;
      // direction : le long du champ de flux, puis tout droit quand le joueur est à portée
      let gx = nx, gy = ny;
      const t = ((z.y / TILE) | 0) * GW + ((z.x / TILE) | 0);
      const fd = dist[t];
      if (fd > 2 && fd !== 65535 && !(d < 140 && fd <= 4)) {
        const nt = nextT[t];
        const ax = (nt % GW + 0.5) * TILE + z.ox - z.x, ay = ((nt / GW | 0) + 0.5) * TILE + z.oy - z.y;
        const al = Math.hypot(ax, ay) || 1;
        gx = ax / al; gy = ay / al;
      }
      const R0 = z.d.ranged;
      if (R0 && d < R0.range + 40) {
        const see = World.los(z.x, z.y, p.x, p.y);
        if (see) {
          if (d < R0.keep) { sp = z.speed * 0.6; gx = -nx; gy = -ny; }
          else if (d < R0.range) sp = 0;
          z.spitT -= zdt;
          if (z.spitT <= 0) {
            z.spitT = R0.cd * rand(0.85, 1.15);
            fx('spit', Math.round(z.x + nx * z.r), Math.round(z.y + ny * z.r), Math.round(nx * R0.speed), Math.round(ny * R0.speed), Math.round(R0.dmg * waveDmgScale(R.wave)));
          }
        }
      }
      if (z.d.boss) {
        if (z.windup > 0) {
          z.windup -= zdt;
          sp = 0;
          if (z.windup <= 0) {
            fx('slam', Math.round(z.x), Math.round(z.y), 150);
            for (const q of ps) if (Math.hypot(q.x - z.x, q.y - z.y) < 150 + q.r) hurtPlayer(q, z.dmg * 0.8, z.x, z.y);
          }
        } else {
          z.slamT -= zdt;
          if (z.slamT <= 0 && d < 170) { z.slamT = 3.8; z.windup = 0.8; fx('slamwarn', Math.round(z.x), Math.round(z.y), 150, 0.8); }
        }
      }
      vx = gx * sp; vy = gy * sp;
      // contact → attaque
      if (d < z.r + p.r + 5) {
        vx = 0; vy = 0;
        z.atkT -= zdt;
        if (z.atkT <= 0) {
          z.atkT = z.d.atkCd;
          if (z.d.explode) { z.hp = 0; killZombie(z, null); continue; }
          hurtPlayer(p, z.dmg, z.x, z.y);
        }
      } else if (z.atkT < z.d.atkCd * 0.4) z.atkT += dt * 0.5;
    }
    z.x += (vx * sf + z.kbx) * dt;
    z.y += (vy * sf + z.kby) * dt;
    z.kbx *= decay; z.kby *= decay;
    if (sf > 0.01 && z.stun <= 0) {
      const ta = Math.atan2(vy || ny, vx || nx);
      z.angle += angDiff(ta, z.angle) * Math.min(1, dt * 8 * sf);
    }
  }

  // séparation entre zombies : c'est elle qui fait enfler la horde dans les couloirs
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead) continue;
    const rr = z.r + 24;
    const x0 = clamp(((z.x - rr) / CELL) | 0, 0, GN - 1), x1 = clamp(((z.x + rr) / CELL) | 0, 0, GN - 1);
    const y0 = clamp(((z.y - rr) / CELL) | 0, 0, GN - 1), y1 = clamp(((z.y + rr) / CELL) | 0, 0, GN - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = grid[cy * GN + cx];
      for (let j = 0; j < c.length; j++) {
        const o = c[j];
        if (o.id <= z.id || o.dead) continue;
        const dx = o.x - z.x, dy = o.y - z.y;
        const m = z.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= m * m) continue;
        const d = Math.sqrt(d2) || 0.01;
        const ov = (m - d) * 0.5;
        const nx = d > 0.01 ? dx / d : Math.random() - 0.5, ny = d > 0.01 ? dy / d : Math.random() - 0.5;
        const wz = o.d.mass / (z.d.mass + o.d.mass), wo = 1 - wz;
        const fz = z.slowF < 0.02 ? 0 : 1, fo = o.slowF < 0.02 ? 0 : 1;
        z.x -= nx * ov * wz * 1.6 * fz;
        z.y -= ny * ov * wz * 1.6 * fz;
        o.x += nx * ov * wo * 1.6 * fo;
        o.y += ny * ov * wo * 1.6 * fo;
        if (Math.abs(z.kbx) + Math.abs(z.kby) > 120) {
          o.kbx += z.kbx * 0.25; o.kby += z.kby * 0.25;
          z.kbx *= 0.85; z.kby *= 0.85;
        }
      }
    }
  }
  // murs et joueurs
  let anyDead = false;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead) { anyDead = true; continue; }
    World.collide(z, z.r);
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      const dx = z.x - p.x, dy = z.y - p.y, m = z.r + p.r;
      if (Math.abs(dx) > m || Math.abs(dy) > m || p.dash) continue;
      const d = Math.hypot(dx, dy);
      if (d < m && d > 0.01) {
        const ov = m - d;
        z.x += dx / d * ov * 0.85; z.y += dy / d * ov * 0.85;
        if (p.local) { p.x -= dx / d * ov * 0.15; p.y -= dy / d * ov * 0.15; }
      }
    }
  }
  if (anyDead) R.zombies = zs.filter(z => !z.dead);
}

// Carte de chaleur de la horde (mini-carte) et rappel des égarés.
function updateHeat() {
  const h = R.heat, N = MAZE_N;
  const cnt = new Uint16Array(N * N);
  let moved = 0;
  for (const z of R.zombies) {
    const tx = (z.x / TILE) | 0, ty = (z.y / TILE) | 0;
    const cx = Math.min(N - 1, (tx / PITCH) | 0), cy = Math.min(N - 1, (ty / PITCH) | 0);
    cnt[cy * N + cx]++;
    const fd = World.dist[ty * GW + tx];
    if ((fd > 52 || fd === 65535) && moved < 24 && !z.d.boss && alivePlayers().length) {
      const s = tileByDist(11, 30, true);
      if (s) { z.x = s.x; z.y = s.y; z.kbx = z.kby = 0; moved++; }
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.min(255, cnt[i] * 6);
}

/* ---------------- Projectiles ---------------- */
function updateBullets(dt) {
  const bs = R.bullets;
  for (const b of bs) {
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    const owner = R.players[b.owner];
    if (b.kind === 'shell' && b.life <= 0) { explode(b.x, b.y, b.radius, b.dmg, true, 1, owner); continue; }
    if (b.life <= 0) continue;
    if (World.solidAt(b.x, b.y)) {
      if (b.kind === 'shell') explode(b.px, b.py, b.radius, b.dmg, true, 1, owner);
      else if (audible(b.x, b.y)) for (let i = 0; i < 3; i++) particle(b.px, b.py, rand(-60, 60), rand(-60, 60), 0.2, 1.5, b.kind === 'wave' ? '#bfeaff' : '#ffd27a');
      b.life = 0; continue;
    }
    const sx = b.px, sy = b.py, ex = b.x, ey = b.y;
    const segx = ex - sx, segy = ey - sy, segL2 = segx * segx + segy * segy || 1;
    near((sx + ex) / 2, (sy + ey) / 2, Math.sqrt(segL2) / 2 + b.r + 40, z => {
      if (b.life <= 0 || b.hit.includes(z.id)) return;
      let t = ((z.x - sx) * segx + (z.y - sy) * segy) / segL2;
      t = clamp(t, 0, 1);
      const cx = sx + segx * t, cy = sy + segy * t;
      const rr = z.r + b.r;
      if (dist2(cx, cy, z.x, z.y) > rr * rr) return;
      if (b.kind === 'shell') { b.x = cx; b.y = cy; explode(cx, cy, b.radius, b.dmg, true, 1, owner); b.life = 0; return; }
      b.hit.push(z.id);
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const kb = (b.kind === 'wave' ? 70 : 45) / z.d.mass;
      hitZombie(z, b.dmg, { kx: b.vx / sp * kb, ky: b.vy / sp * kb, canCrit: true, p: owner });
      if (b.pierce > 0) b.pierce--; else b.life = 0;
    });
  }
  R.bullets = bs.filter(b => b.life > 0);

  // crachats (et crachats renvoyés)
  const ps = alivePlayers();
  for (const b of R.eproj) {
    let f = 1;
    for (const p of R.players) {
      if (p.cls !== 'samurai' || p.gone) continue;
      if (!b.friendly && p.stasisT > 0 && dist2(b.x, b.y, p.x, p.y) < p.st.stasis.radius ** 2) f = Math.min(f, 1 - p.st.stasis.slow * 0.9);
      if (!b.friendly && p.ultT > 0 && dist2(b.x, b.y, p.x, p.y) < (p.st.ult.radius + 12) ** 2) {
        b.life = 0;
        for (let i = 0; i < 4; i++) particle(b.x, b.y, rand(-90, 90), rand(-90, 90), 0.22, 2, '#c8f4ff');
      }
    }
    b.x += b.vx * dt * f; b.y += b.vy * dt * f;
    b.life -= dt;
    if (b.life <= 0) continue;
    if (World.solidAt(b.x, b.y)) { b.life = 0; splat(b.x, b.y); continue; }
    if (b.friendly) {
      near(b.x, b.y, 40, z => {
        if (b.life <= 0) return;
        if (dist2(z.x, z.y, b.x, b.y) < (z.r + b.r) ** 2) { hitZombie(z, b.dmg, { canCrit: true, p: R.players[b.owner] }); b.life = 0; splat(b.x, b.y); }
      });
    } else {
      for (const p of ps) {
        if (b.life > 0 && dist2(p.x, p.y, b.x, b.y) < (p.r + b.r) ** 2) {
          hurtPlayer(p, b.dmg, b.x - b.vx, b.y - b.vy);
          b.life = 0; splat(b.x, b.y);
        }
      }
    }
    if (Math.random() < 0.3) particle(b.x, b.y, rand(-15, 15), rand(-15, 15), 0.3, 3, b.friendly ? 'rgba(150,230,255,0.7)' : 'rgba(150,230,60,0.7)');
  }
  R.eproj = R.eproj.filter(b => b.life > 0);

  // grenades lancées
  for (const g of R.grenades) {
    if (g.t < g.dur) {
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      g.x = g.sx + (g.tx - g.sx) * k; g.y = g.sy + (g.ty - g.sy) * k;
      g.h = Math.sin(k * Math.PI) * 60;
    } else {
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.done = true;
        if (!R.auth) continue;
        explode(g.x, g.y, g.radius, g.dmg, true, g.mini ? 0.5 : 1.3, R.players[g.owner]);
        for (let i = 0; i < g.frag; i++) {
          const a = i / g.frag * TAU + rand(-0.3, 0.3), dd = rand(60, 120);
          const land = { x: g.x + Math.cos(a) * dd, y: g.y + Math.sin(a) * dd };
          World.collide(land, 6);
          fx('nade', g.owner, Math.round(g.x), Math.round(g.y), Math.round(land.x), Math.round(land.y), 0.3, 0.15 + i * 0.06, g.dmg * 0.4, g.radius * 0.55, 0, 1);
        }
      }
    }
  }
  R.grenades = R.grenades.filter(g => !g.done);

  for (const b of R.bombs) {
    b.t -= dt;
    if (b.t <= 0) explode(b.x, b.y, b.r, b.dmg, false, 1, null);
  }
  R.bombs = R.bombs.filter(b => b.t > 0);

  if (!R.auth) return;
  // tourelles
  for (const t of R.turrets) {
    t.t -= dt;
    t.fireT -= dt;
    t.muzzle = Math.max(0, t.muzzle - dt);
    const owner = R.players[t.owner];
    if (!t.tgt || t.tgt.dead || (t.scanT -= dt) <= 0) {
      t.scanT = 0.25;
      const c = [];
      near(t.x, t.y, 480, z => { const d = dist2(z.x, z.y, t.x, t.y); if (d < 480 * 480) { z._d = d; c.push(z); } });
      c.sort((a, b) => a._d - b._d);
      t.tgt = null;
      for (let i = 0; i < c.length && i < 10; i++) if (World.los(t.x, t.y, c[i].x, c[i].y)) { t.tgt = c[i]; break; }
    }
    if (t.tgt) {
      const ta = Math.atan2(t.tgt.y - t.y, t.tgt.x - t.x);
      t.angle += angDiff(ta, t.angle) * Math.min(1, dt * 12);
      if (t.fireT <= 0 && Math.abs(angDiff(ta, t.angle)) < 0.3) {
        t.fireT = 1 / owner.st.turret.rate;
        t.muzzle = 0.05;
        fx('tshot', t.owner, Math.round(t.x), Math.round(t.y), Math.round((t.angle + rand(-0.05, 0.05)) * 1000) / 1000);
      }
    }
  }
  R.turrets = R.turrets.filter(t => t.t > 0);
}

/* ---------------- Objets au sol ---------------- */
function dropOrb(kind, x, y, v) {
  const a = Math.random() * TAU, sp = rand(40, 120);
  fx('orb', R.nextId++, kind, Math.round(x), Math.round(y), Math.round(Math.cos(a) * sp), Math.round(Math.sin(a) * sp), v);
}

function spawnCrate(x, y, big) {
  const c = { x: clamp(x, 60, WORLD - 60), y: clamp(y, 60, WORLD - 60), t: 0, big: !!big, r: 16 };
  World.collide(c, 22);
  R.crates.push(c);
}

function openCrate(c, p) {
  const st = p.st;
  const list = availableWeapons(p).filter(k => k !== 'pistol');
  const msgs = [];
  const giveAmmo = (k, f) => {
    const w = st.weapons[k];
    const before = p.ammo[k];
    p.ammo[k] = Math.min(w.cap, p.ammo[k] + Math.max(1, Math.round(w.crate * f)));
    const got = p.ammo[k] - before;
    if (got > 0) msgs.push('+' + got + ' ' + WEAPON_NAMES[k]);
  };
  if (list.length) {
    const weights = list.map(k => 1.2 - p.ammo[k] / st.weapons[k].cap);
    const pick = () => {
      let tot = weights.reduce((a, b) => a + b, 0), r = Math.random() * tot;
      for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return i; }
      return list.length - 1;
    };
    const i = pick();
    giveAmmo(list[i], c.big ? 1.5 : 1);
    if (list.length > 1 && (c.big || Math.random() < 0.35)) {
      weights[i] = 0;
      giveAmmo(list[pick()], 0.5);
    }
  }
  if (Math.random() < st.medChance || c.big) {
    const before = p.hp;
    healPlayer(p, st.medHeal, false);
    if (p.hp > before) msgs.push('+' + Math.round(p.hp - before) + ' PV');
  }
  if (st.grenades && (Math.random() < 0.45 || c.big) && p.grenades < st.grenades.max) {
    const before = p.grenades;
    p.grenades = Math.min(st.grenades.max, p.grenades + (c.big ? 2 : 1));
    msgs.push('+' + (p.grenades - before) + ' grenade' + (p.grenades - before > 1 ? 's' : ''));
  }
  if (!msgs.length) {
    const v = 3 + R.wave;
    gainSouls(v, true);
    msgs.push('+' + v + ' âmes');
  }
  fx('crateOpen', Math.round(c.x), Math.round(c.y), msgs, p.id);
}

const RELICS = ['fury', 'nova', 'frost'];
function spawnRelic() {
  const s = tileByDist(16, 44, false) || tileByDist(8, 65000, false);
  if (!s) return;
  fx('relicSpawn', s.x, s.y, RELICS[(Math.random() * RELICS.length) | 0]);
}
function takeRelic(p) {
  const { kind, x, y } = R.relic;
  if (kind === 'fury') R.furyT = 20;
  else if (kind === 'nova') {
    near(x, y, 620, z => {
      const dx = z.x - x, dy = z.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > 620) return;
      hitZombie(z, 140 * waveHpScale(R.wave) * (1.2 - d / 620), { raw: true, p, kx: dx / d * 500 / z.d.mass, ky: dy / d * 500 / z.d.mass, silent: true });
    });
  } else {
    near(x, y, 900, z => { if (dist2(z.x, z.y, x, y) < 900 * 900) z.stun = Math.max(z.stun, z.d.boss ? 2.5 : 6); });
  }
  R.relicT = 22;
  fx('relic', kind, Math.round(x), Math.round(y), p.id);
}

function afterShift() {
  for (const z of R.zombies) World.collide(z, z.r);
  for (const p of R.players) World.collide(p, p.r);
  for (const c of R.crates) World.collide(c, 22);
  for (const t of R.turrets) World.collide(t, 16);
  if (R.relic) World.collide(R.relic, 20);
  World.flow(alivePlayers());
}

function updatePickups(dt) {
  const ps = alivePlayers();
  for (const o of R.orbs) {
    o.t += dt;
    o.life -= dt;
    // attiré par le joueur le plus proche (les chargeurs ne suivent que le Soldat)
    let p = null, d = 1e9, dx = 0, dy = 0;
    for (const q of ps) {
      if (o.kind === 'ammo' && q.cls !== 'soldier') continue;
      const ex = q.x - o.x, ey = q.y - o.y, e = Math.hypot(ex, ey);
      if (e < d) { p = q; d = e; dx = ex; dy = ey; }
    }
    if (p) {
      const mag = o.kind === 'soul' ? p.st.magnet : p.st.magnet * 0.6;
      if (d < mag || (o.attract && d < mag * 3)) {
        o.attract = true;
        const sp = 300 + o.t * 300;
        o.vx = dx / (d || 1) * sp; o.vy = dy / (d || 1) * sp;
      } else {
        o.attract = false;
        const dec = Math.exp(-4 * dt); o.vx *= dec; o.vy *= dec;
      }
    }
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (!o.attract && World.solidAt(o.x, o.y)) { o.x -= o.vx * dt; o.y -= o.vy * dt; o.vx = o.vy = 0; }
    if (R.auth && p && d < p.r + 10) {
      o.life = 0;
      if (o.kind === 'soul') gainSouls(o.v);
      else if (o.kind === 'heal') healPlayer(p, o.v);
      else {
        const list = availableWeapons(p).filter(k => k !== 'pistol');
        if (list.length) {
          const k = list[(Math.random() * list.length) | 0];
          const w = p.st.weapons[k];
          const g = Math.max(1, Math.round(w.crate * o.v));
          p.ammo[k] = Math.min(w.cap, p.ammo[k] + g);
          fx('text', p.x, p.y - 30, '+' + g + ' ' + WEAPON_NAMES[k], '#ffd86a', 0.9, 0.8);
        }
      }
      fx('pick', o.id, p.id, o.kind);
    }
  }
  R.orbs = R.orbs.filter(o => o.life > 0);
  if (R.relic) R.relic.t += dt;
  for (const c of R.crates) c.t += dt;
  if (!R.auth) return;

  if (R.relic) {
    const p = ps.find(q => dist2(q.x, q.y, R.relic.x, R.relic.y) < 40 * 40);
    if (p) takeRelic(p);
  } else if (R.relicT > 0) {
    R.relicT -= dt;
    if (R.relicT <= 0 && R.wave >= 2) spawnRelic();
  }

  const sol = ps.find(q => q.cls === 'soldier');
  if (sol) {
    R.crateT -= dt;
    if (R.crateT <= 0) {
      R.crateT = sol.st.crateInterval * rand(0.85, 1.15);
      if (R.crates.length < 5) {
        const s = tileByDist(5, 20, false);
        if (s) spawnCrate(s.x, s.y, false);
      }
    }
    for (const c of R.crates) {
      if (c.t > 0.6 && Math.hypot(sol.x - c.x, sol.y - c.y) < sol.r + 24) { c.opened = true; openCrate(c, sol); }
    }
    R.crates = R.crates.filter(c => !c.opened);
  }
}

/* ---------------- Effets ---------------- */
function updateFx(dt) {
  for (const q of R.particles) {
    q.life -= dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    const drag = q.kind === 'fire' ? 3 : q.kind === 'smoke' ? 1.2 : q.kind === 'shell' ? 6 : 4;
    const dec = Math.exp(-drag * dt);
    q.vx *= dec; q.vy *= dec;
    if (q.kind === 'smoke') q.size += dt * 14;
  }
  R.particles = R.particles.filter(q => q.life > 0);
  for (const f of R.fx) f.t += dt;
  R.fx = R.fx.filter(f => f.t < f.dur);
  for (const t of R.texts) { t.t += dt; t.y -= dt * 30; }
  R.texts = R.texts.filter(t => t.t < t.dur);
  for (const d of R.decals) if (d.kind !== 'blood') d.a -= dt * 0.03;
  if (R.banner) { R.banner.t += dt; if (R.banner.t > R.banner.dur) R.banner = null; }
  R.hintT -= dt;
  R.levelFlash = Math.max(0, R.levelFlash - dt * 1.5);
  R.cam.shake *= Math.exp(-8 * dt);
  if (R.shift) R.shift.t = Math.max(0, R.shift.t - dt);
}

/* ---------------- Fin de partie ---------------- */
function gameOver() {
  if (R.over) return;
  fx('over');
}

function summary() {
  const p = me();
  return { cls: p.cls, wave: Math.max(1, R.wave), kills: R.kills, myKills: p.kills, souls: Math.round(p.souls), time: R.t,
    cleared: R.cleared, startWave: R.startWave, coop: R.coop, level: R.level, combo: R.comboBest };
}

/* ---------------- Pas de simulation (solo / hôte) ---------------- */
function stepAuth(dt) {
  R.t += dt;
  readLocalInput(me());
  R.flowT -= dt;
  if (R.flowT <= 0) { R.flowT = 0.15; World.flow(alivePlayers()); }
  R.heatT -= dt;
  if (R.heatT <= 0) { R.heatT = 0.5; updateHeat(); }
  updateWaves(dt);
  for (const p of R.players) updatePlayer(p, dt);
  updateZombies(dt);
  updateBullets(dt);
  updatePickups(dt);
  updateFx(dt);
  if (R.furyT > 0) R.furyT -= dt;
  if (R.comboT > 0) { R.comboT -= dt; if (R.comboT <= 0) R.combo = 0; }
  if (R.shift && R.shift.t <= 0) fx('shift', R.shift.open, R.shift.close);
  R.left = Math.max(0, R.normalTotal - R.spawned) + R.zombies.length + R.bossesPending;
  if (!alivePlayers().length) gameOver();
}
