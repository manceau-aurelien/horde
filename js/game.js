'use strict';
/* HORDE — moteur de jeu. */

const Game = (() => {
  const ARENA = 2400;
  const CELL = 64;
  const GN = Math.ceil(ARENA / CELL) + 2;
  const ALIVE_CAP = 280;
  const TAU = Math.PI * 2;

  let canvas, ctx, W = 800, H = 600, dpr = 1, zoom = 1;
  let R = null;            // partie en cours
  let paused = false;
  let settings = { dmgNumbers: true, autoAim: false, autoAttack: false, shake: true };
  let hooks = {};
  let groundPattern = null;
  let lastFrame = 0, acc = 0;
  let touchMode = false;

  /* ---------------- Entrées ---------------- */
  const keys = {};
  const pressed = {};      // actions déclenchées une fois
  const held = {};         // actions maintenues (tactile)
  const mouse = { x: 0, y: 0, left: false, inside: false };
  const sticks = { move: null, aim: null }; // { id, ox, oy, x, y }

  const KEYMAP = {
    KeyE: 'secondary', Space: 'mobility', ShiftLeft: 'mobility', KeyF: 'special', KeyR: 'ultimate',
    Digit1: 'w0', Digit2: 'w1', Digit3: 'w2', Digit4: 'w3', Digit5: 'w4', Digit6: 'w5',
    Numpad1: 'w0', Numpad2: 'w1', Numpad3: 'w2', Numpad4: 'w3', Numpad5: 'w4', Numpad6: 'w5',
    KeyQ: 'swap', Tab: 'swap',
  };

  function bindInput() {
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (R && !R.over) { togglePause(); e.preventDefault(); } return; }
      if (e.code === 'KeyM') { hooks.onMute && hooks.onMute(); return; }
      if (!R || paused) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
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
      if (R.cls === 'soldier') cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    const tstart = e => {
      Sfx.init();
      if (!touchMode) setTouchMode(true);
      for (const t of e.changedTouches) {
        if (t.clientX < W * 0.5) {
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
            // le joystick suit le doigt s'il va trop loin
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

  /* ---------------- Outils ---------------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  /* ---------------- Grille spatiale ---------------- */
  const grid = Array.from({ length: GN * GN }, () => []);
  const usedCells = [];
  function gridClear() {
    for (const c of usedCells) c.length = 0;
    usedCells.length = 0;
  }
  function gridBuild() {
    for (const c of usedCells) c.length = 0;
    usedCells.length = 0;
    for (const z of R.zombies) {
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

  /* ---------------- Terrain post-apocalyptique (ruines & goulots) ---------------- */
  function makeObstacles() {
    const obs = [];
    const floors = [];
    let nextObsId = 1;
    const C = ARENA / 2;
    const T = 22; // épaisseur des murs en ruine

    const addWallRect = (x1, y1, x2, y2, theme) => {
      const w = Math.round(x2 - x1), h = Math.round(y2 - y1);
      if (w < 34 && h < 34) return;
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const hw = w / 2, hh = h / 2;
      obs.push({
        id: nextObsId++, kind: 'rect', isWall: true,
        x: cx, y: cy, hw, hh, reach: Math.hypot(hw, hh),
        img: Sprites.wall(w, h, theme),
      });
    };

    // Découpe un segment de mur [a, b] en laissant une large brèche [g0, g1]
    const addSplitWallH = (x1, x2, y, g0, g1, theme) => {
      if (g0 - x1 >= 42) addWallRect(x1, y - T / 2, g0, y + T / 2, theme);
      if (x2 - g1 >= 42) addWallRect(g1, y - T / 2, x2, y + T / 2, theme);
    };
    const addSplitWallV = (x, y1, y2, g0, g1, theme) => {
      if (g0 - y1 >= 42) addWallRect(x - T / 2, y1, x + T / 2, g0, theme);
      if (y2 - g1 >= 42) addWallRect(x - T / 2, g1, x + T / 2, y2, theme);
    };

    // Chaque maison cassée combine des pans de murs avec brèches centrales et coins effondrés
    const coords = [340, 910, 1490, 2060];
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const bx = coords[gx] + rand(-14, 14);
        const by = coords[gy] + rand(-14, 14);
        const w = Math.round(rand(330, 372));
        const h = Math.round(rand(315, 358));
        const x1 = Math.round(bx - w / 2), x2 = x1 + w;
        const y1 = Math.round(by - h / 2), y2 = y1 + h;
        const theme = (gx + gy * 2 + (Math.random() * 2 | 0)) % 3;

        floors.push({ x: bx, y: by, w, h, img: Sprites.houseFloor(w, h, theme) });

        // Coins effondrés alternés (40-55 px) et larges brèches (115-140 px) pour un vrai air de ruines
        // où l'on circule entre les pans de murs sans cul-de-sac fermé
        const cNW = ((gx + gy) % 2 === 0) ? 48 : 0;
        const cSE = ((gx + gy) % 2 === 0) ? 0 : 48;
        const cNE = ((gx * 3 + gy) % 2 === 0) ? 48 : 0;
        const cSW = ((gx * 3 + gy) % 2 === 0) ? 0 : 48;

        const gapN = rand(116, 140), offN = rand(-32, 32);
        addSplitWallH(x1 + cNW, x2 - cNE, y1, bx + offN - gapN / 2, bx + offN + gapN / 2, theme);

        const gapS = rand(116, 140), offS = rand(-32, 32);
        addSplitWallH(x1 + cSW, x2 - cSE, y2, bx + offS - gapS / 2, bx + offS + gapS / 2, theme);

        const gapW = rand(114, 138), offW = rand(-28, 28);
        addSplitWallV(x1, y1 + T / 2 + cNW, y2 - T / 2 - cSW, by + offW - gapW / 2, by + offW + gapW / 2, theme);

        const gapE = rand(114, 138), offE = rand(-28, 28);
        addSplitWallV(x2, y1 + T / 2 + cNE, y2 - T / 2 - cSE, by + offE - gapE / 2, by + offE + gapE / 2, theme);

        // Cloison intérieure cassée (ne touche pas les murs extérieurs : laisse des passages latéraux ET centraux)
        const interiorHoriz = ((gx + gy) % 2 === 0);
        if (interiorHoriz) {
          const iy = Math.round(by + rand(-22, 22));
          addWallRect(bx - 72, iy - T / 2, bx + 72, iy + T / 2, theme);
        } else {
          const ix = Math.round(bx + rand(-22, 22));
          addWallRect(ix - T / 2, by - 68, ix + T / 2, by + 68, theme);
        }
      }
    }

    // Distance minimale entre un point (x, y) et tout obstacle existant
    const minClearance = (x, y, rad) => {
      let minD = 1e9;
      for (const o of obs) {
        let d;
        if (o.kind === 'circle') {
          d = Math.hypot(x - o.x, y - o.y) - o.r - rad;
        } else {
          const cx = clamp(x, o.x - o.hw, o.x + o.hw), cy = clamp(y, o.y - o.hh, o.y + o.hh);
          d = Math.hypot(x - cx, y - cy) - rad;
        }
        if (d < minD) minD = d;
      }
      return minD;
    };

    // Goulots d'étranglement dans les rues entre les maisons :
    // épaves de voitures, barricades de fortune, gravats et arbres calcinés.
    // On place chaque obstacle au centre des larges avenues ou des carrefours
    // en garantissant au moins 98 px de passage tout autour pour ne jamais bloquer totalement.
    const streetLanes = [625, 1200, 1775];
    // Carrefours et tronçons de rues horizontales / verticales
    for (const sx of streetLanes) {
      for (const sy of coords) {
        if (Math.hypot(sx - C, sy - C) < 210) continue;
        const vertical = true;
        const isCar = Math.random() < 0.55;
        const w = isCar ? 98 : 86, h = isCar ? 48 : 28;
        const hw = vertical ? h / 2 : w / 2, hh = vertical ? w / 2 : h / 2;
        const reach = Math.hypot(hw, hh);
        const ox = sx + rand(-14, 14), oy = sy + rand(-35, 35);
        if (minClearance(ox, oy, reach) >= 92) {
          obs.push({
            id: nextObsId++, kind: 'rect', x: ox, y: oy, hw, hh, reach,
            img: isCar ? Sprites.car(w, h, vertical) : Sprites.barricade(w, h, vertical),
          });
        }
      }
    }
    for (const sy of streetLanes) {
      for (const sx of coords) {
        if (Math.hypot(sx - C, sy - C) < 210) continue;
        const vertical = false;
        const isCar = Math.random() < 0.5;
        const w = isCar ? 98 : 86, h = isCar ? 48 : 28;
        const hw = w / 2, hh = h / 2;
        const reach = Math.hypot(hw, hh);
        const ox = sx + rand(-35, 35), oy = sy + rand(-14, 14);
        if (minClearance(ox, oy, reach) >= 92) {
          obs.push({
            id: nextObsId++, kind: 'rect', x: ox, y: oy, hw, hh, reach,
            img: isCar ? Sprites.car(w, h, vertical) : Sprites.barricade(w, h, vertical),
          });
        }
      }
    }

    // Gravats, arbres morts et bidons supplémentaires aux carrefours et allées périphériques
    const placeExtra = (n, rad, fn) => {
      for (let i = 0, tries = 0; i < n && tries < 500; tries++) {
        const x = rand(95, ARENA - 95), y = rand(95, ARENA - 95);
        if (Math.hypot(x - C, y - C) < 190 + rad) continue;
        if (minClearance(x, y, rad) < 96) continue;
        const item = fn(x, y);
        item.id = nextObsId++;
        obs.push(item);
        i++;
      }
    };
    placeExtra(16, 30, (x, y) => { const r = rand(22, 34); return { kind: 'circle', x, y, r, reach: r, img: Sprites.rock(r), canopy: null }; });
    placeExtra(14, 20, (x, y) => ({ kind: 'circle', x, y, r: 15, reach: 15, img: null, canopy: Sprites.tree(18), trunk: true }));
    placeExtra(14, 16, (x, y) => ({ kind: 'circle', x, y, r: 14, reach: 14, img: Sprites.barrel(14) }));

    // Marque pour chaque mur si une extrémité touche un coin fermé (autre mur proche)
    // afin que les zombies contournent toujours vers la brèche ouverte.
    const nearOtherWall = (self, px, py) => {
      for (const o of obs) {
        if (o === self || o.kind !== 'rect') continue;
        const cx = clamp(px, o.x - o.hw, o.x + o.hw), cy = clamp(py, o.y - o.hh, o.y + o.hh);
        if (Math.hypot(px - cx, py - cy) < 34) return true;
      }
      return false;
    };
    for (const o of obs) {
      if (o.kind !== 'rect') continue;
      if (o.hw >= o.hh) {
        o.blockMin = nearOtherWall(o, o.x - o.hw - 20, o.y);
        o.blockMax = nearOtherWall(o, o.x + o.hw + 20, o.y);
      } else {
        o.blockMin = nearOtherWall(o, o.x, o.y - o.hh - 20);
        o.blockMax = nearOtherWall(o, o.x, o.y + o.hh + 20);
      }
    }

    R.floors = floors;
    return obs;
  }

  // Repousse un cercle hors des obstacles. Renvoie la normale et l'obstacle du dernier contact.
  function collideObstacles(e, r) {
    let hit = null;
    for (const o of R.obstacles) {
      const dx = e.x - o.x, dy = e.y - o.y;
      if (Math.abs(dx) > o.reach + r || Math.abs(dy) > o.reach + r) continue;
      if (o.kind === 'circle') {
        const d = Math.hypot(dx, dy), m = o.r + r;
        if (d < m && d > 0.0001) {
          const nx = dx / d, ny = dy / d;
          e.x = o.x + nx * m; e.y = o.y + ny * m;
          hit = { nx, ny, o };
        }
      } else {
        const cx = clamp(e.x, o.x - o.hw, o.x + o.hw), cy = clamp(e.y, o.y - o.hh, o.y + o.hh);
        let ddx = e.x - cx, ddy = e.y - cy;
        let d = Math.hypot(ddx, ddy);
        if (d < r) {
          if (d < 0.0001) { // centre à l'intérieur
            const px = o.hw - Math.abs(dx), py = o.hh - Math.abs(dy);
            if (px < py) { ddx = Math.sign(dx) || 1; ddy = 0; e.x = o.x + ddx * (o.hw + r); }
            else { ddx = 0; ddy = Math.sign(dy) || 1; e.y = o.y + ddy * (o.hh + r); }
            hit = { nx: ddx, ny: ddy, o };
          } else {
            const nx = ddx / d, ny = ddy / d;
            e.x = cx + nx * r; e.y = cy + ny * r;
            hit = { nx, ny, o };
          }
        }
      }
    }
    return hit;
  }

  function pointInObstacle(x, y) {
    for (const o of R.obstacles) {
      if (o.trunk) continue;
      if (o.kind === 'circle') { if (dist2(x, y, o.x, o.y) < o.r * o.r) return o; }
      else if (Math.abs(x - o.x) < o.hw && Math.abs(y - o.y) < o.hh) return o;
    }
    return null;
  }

  /* ---------------- Création d'une partie ---------------- */
  function newRun(cls, levels, startWave, opts) {
    hooks = Object.assign(hooks, opts || {});
    const st = computeStats(cls, levels);
    R = {
      cls, st, t: 0,
      wave: 0, phase: 'break', breakT: 2.5, waveTotal: 0, spawned: 0, killedWave: 0, spawnT: 0, bossesPending: 0,
      startWave: Math.max(1, startWave | 0),
      zombies: [], bullets: [], eproj: [], particles: [], decals: [], orbs: [], crates: [], fx: [], texts: [],
      turrets: [], grenades: [], bombs: [],
      obstacles: null, floors: [],
      kills: 0, souls: 0, nextId: 1, crateT: 10, over: false, overT: 0, slowmo: 1,
      banner: null, hintT: 9, cam: { x: ARENA / 2, y: ARENA / 2, shake: 0 },
      lowHpPulse: 0,
    };
    gridClear();
    R.obstacles = makeObstacles();
    const p = {
      x: ARENA / 2, y: ARENA / 2, r: 15, angle: 0, hp: st.maxHp, energy: st.energyMax || 0,
      atkT: 0, attackCount: 0, swingT: 0, swingDir: 1, swingArc: 0, whirlT: 0,
      dash: null, invuln: 0, stasisT: 0, ultT: 0, ultCd: 0, ultTick: 0, hurtT: 0, secondUsed: false,
      energyFlash: 0, moving: false, walkPhase: 0,
      // soldat
      weapon: 'pistol', ammo: {}, grenades: 0, fireT: 0, muzzle: 0, rollCd: 0, adrenT: 0, adrenCd: 0, turretCd: 0, nadeCd: 0, recoil: 0,
    };
    if (cls === 'soldier') {
      for (const k of WEAPON_ORDER) p.ammo[k] = st.weapons[k].infinite ? Infinity : st.weapons[k].start;
      p.grenades = st.grenades ? st.grenades.start : 0;
      const best = bestWeapon(p, st);
      if (best) p.weapon = best;
    }
    R.p = p;
    R.wave = R.startWave - 1;
    paused = false;
    for (const k in pressed) pressed[k] = false;
    resize();
    return R;
  }

  /* ---------------- Vagues ---------------- */
  function startWave(n) {
    R.wave = n;
    R.phase = 'fight';
    R.normalTotal = waveTotal(n);
    R.waveTotal = R.normalTotal;
    R.spawned = 0;
    R.killedWave = 0;
    R.spawnT = 0.5;
    R.bossesPending = n % 10 === 0 ? n / 10 : 0;
    R.bossT = 4;
    R.waveTotal += R.bossesPending;
    R.banner = { text: 'VAGUE ' + n, sub: R.bossesPending ? '⚠ Un Colosse approche…' : waveSub(n), t: 0, dur: 2.6 };
    Sfx.wave();
    // Largage : uniquement à partir de la 2e vague jouée pour ne pas surcharger le début de partie
    if (R.cls === 'soldier' && R.st.waveDrop && n > R.startWave) {
      for (let i = 0; i < R.st.waveDrop; i++) {
        const a = Math.random() * TAU;
        spawnCrate(R.p.x + Math.cos(a) * rand(90, 170), R.p.y + Math.sin(a) * rand(90, 170), R.st.waveDrop >= 3);
      }
    }
    hooks.onWave && hooks.onWave(n);
  }

  function waveSub(n) {
    if (n === 4) return 'Des coureurs arrivent !';
    if (n === 5) return 'Attention aux Gonflés : ils explosent.';
    if (n === 7) return 'Les Brutes encaissent beaucoup.';
    if (n === 9) return 'Les Cracheurs attaquent à distance.';
    return waveTotal(n) + ' zombies';
  }

  function viewRadius() { return Math.hypot(W, H) / 2 / zoom; }

  function spawnPoint() {
    const D = viewRadius() + 70;
    const p = R.p;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * TAU;
      const x = p.x + Math.cos(a) * D, y = p.y + Math.sin(a) * D;
      if (x < 40 || y < 40 || x > ARENA - 40 || y > ARENA - 40) continue;
      if (pointInObstacle(x, y)) continue;
      return { x, y };
    }
    // repli : coin de l'arène le plus éloigné
    const corners = [[60, 60], [ARENA - 60, 60], [60, ARENA - 60], [ARENA - 60, ARENA - 60]];
    corners.sort((a, b) => dist2(b[0], b[1], p.x, p.y) - dist2(a[0], a[1], p.x, p.y));
    const c = corners[(Math.random() * 2) | 0];
    return { x: c[0], y: c[1] };
  }

  function spawnZombie(type, x, y) {
    const d = ZTYPES[type];
    const n = R.wave;
    const hp = d.hp * waveHpScale(n);
    const z = {
      id: R.nextId++, type, d, x, y, r: d.r, hp, maxHp: hp,
      speed: rand(d.speed[0], d.speed[1]) * (1 + Math.min(0.15, n * 0.004)),
      dmg: d.dmg * waveDmgScale(n), atkT: rand(0, 0.5), angle: 0, kbx: 0, kby: 0, stun: 0, slowF: 1,
      flash: 0, burn: 0, burnDps: 0, variant: (Math.random() * 4) | 0, wob: Math.random() * TAU, dead: false,
      spitT: d.ranged ? rand(1, d.ranged.cd) : 0, inStasis: false, slamT: d.boss ? 3 : 0, spawnFade: 0,
    };
    R.zombies.push(z);
    return z;
  }

  function spawnGroup() {
    const remaining = R.normalTotal - R.spawned;
    if (remaining <= 0) return;
    const size = Math.min(remaining, Math.round(rand(3, 6 + R.wave / 3)));
    const c = spawnPoint();
    for (let i = 0; i < size; i++) {
      const z = spawnZombie(pickZombieType(R.wave, Math.random()), c.x + rand(-55, 55), c.y + rand(-55, 55));
      z.x = clamp(z.x, 30, ARENA - 30); z.y = clamp(z.y, 30, ARENA - 30);
      collideObstacles(z, z.r);
      R.spawned++;
    }
    if (Math.random() < 0.3) Sfx.groan();
  }

  function updateWaves(dt) {
    if (R.phase === 'break') {
      R.breakT -= dt;
      if (R.breakT <= 0) startWave(R.wave + 1);
      return;
    }
    R.spawnT -= dt;
    const normalTotal = R.normalTotal;
    if (R.spawnT <= 0 && R.spawned < normalTotal && R.zombies.length < ALIVE_CAP) {
      spawnGroup();
      R.spawnT = Math.max(0.5, 2.4 - 0.05 * R.wave);
    }
    if (R.bossesPending > 0) {
      R.bossT -= dt;
      if (R.bossT <= 0) {
        const c = spawnPoint();
        spawnZombie('boss', c.x, c.y);
        R.bossesPending--;
        R.bossT = 6;
        Sfx.groan();
        shake(8);
      }
    }
    // sécurité : s'il ne reste que quelques zombies introuvables, ils reviennent près du joueur
    if (R.spawned >= normalTotal && R.zombies.length && R.zombies.length <= 6 && R.t - (R.lastKillT || 0) > 20) {
      for (const z of R.zombies) { const s = spawnPoint(); z.x = s.x; z.y = s.y; }
      R.lastKillT = R.t;
    }
    if (R.spawned >= normalTotal && R.bossesPending === 0 && R.zombies.length === 0) {
      // vague terminée
      const bonus = Math.round((5 + 3 * R.wave) * R.st.soulMult);
      gainSouls(bonus);
      R.phase = 'break';
      R.breakT = 6;
      R.banner = { text: 'VAGUE ' + R.wave + ' TERMINÉE', sub: '+' + bonus + ' âmes', t: 0, dur: 3 };
      Sfx.clear();
      hooks.onWaveClear && hooks.onWaveClear(R.wave);
    }
  }

  function gainSouls(n) {
    R.souls += n;
    hooks.onSouls && hooks.onSouls(n);
  }

  /* ---------------- Joueur ---------------- */
  function aimTarget() {
    // cible la plus proche (visée automatique)
    let best = null, bd = 1e12;
    const p = R.p;
    const maxR = 520;
    near(p.x, p.y, maxR, z => {
      const d = dist2(z.x, z.y, p.x, p.y);
      if (d < bd && d < maxR * maxR) { bd = d; best = z; }
    });
    return best;
  }

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

  function updatePlayer(dt) {
    const p = R.p, st = R.st;
    const { mx, my } = moveInput();
    p.moving = mx !== 0 || my !== 0;

    // Visée
    let manualAim = false, attackHeld = false, target = null;
    if (sticks.aim) {
      const dx = sticks.aim.x - sticks.aim.ox, dy = sticks.aim.y - sticks.aim.oy;
      if (Math.hypot(dx, dy) > 12) { p.angle = Math.atan2(dy, dx); manualAim = true; }
      attackHeld = true;
    } else if (!touchMode && !settings.autoAim && mouse.inside) {
      const wx = (mouse.x - W / 2) / zoom + R.cam.x, wy = (mouse.y - H / 2) / zoom + R.cam.y;
      p.angle = Math.atan2(wy - p.y, wx - p.x);
      p.aimX = wx; p.aimY = wy;
      manualAim = true;
    }
    if (!manualAim) {
      target = aimTarget();
      if (target) {
        p.angle = Math.atan2(target.y - p.y, target.x - p.x);
        p.aimX = target.x; p.aimY = target.y;
      } else if (p.moving) p.angle = Math.atan2(my, mx);
    } else if (sticks.aim) {
      p.aimX = p.x + Math.cos(p.angle) * 300; p.aimY = p.y + Math.sin(p.angle) * 300;
    }
    if (mouse.left && !touchMode) attackHeld = true;
    if (held.attack) attackHeld = true;
    const autoAtk = (touchMode || settings.autoAttack) && !sticks.aim;

    // Déplacement
    let speed = st.speed;
    if (R.cls === 'samurai' && p.ultT > 0) speed *= 1.08;
    if (R.cls === 'soldier') {
      if (p.adrenT > 0) speed *= st.adren.speedMult || 1.3;
      if (p.weapon === 'minigun' && (attackHeld || p.fireT > 0)) speed *= st.weapons.minigun.slow;
    }
    if (p.dash) {
      p.dash.t -= dt;
      p.x += p.dash.vx * dt; p.y += p.dash.vy * dt;
      if (p.dash.cut) dashCut(p);
      if (p.dash.t <= 0) p.dash = null;
    } else {
      p.x += mx * speed * dt; p.y += my * speed * dt;
    }
    if (p.moving) p.walkPhase += dt * speed / 22;
    p.x = clamp(p.x, p.r + 4, ARENA - p.r - 4);
    p.y = clamp(p.y, p.r + 4, ARENA - p.r - 4);
    collideObstacles(p, p.r);

    // Timers
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.energyFlash = Math.max(0, p.energyFlash - dt);
    p.swingT = Math.max(0, p.swingT - dt);
    p.muzzle = Math.max(0, p.muzzle - dt);
    p.recoil = Math.max(0, p.recoil - dt * 8);
    if (st.regen && p.hp < st.maxHp) p.hp = Math.min(st.maxHp, p.hp + st.regen * dt);

    if (R.cls === 'samurai') updateSamurai(p, st, dt, attackHeld, autoAtk, target);
    else updateSoldier(p, st, dt, attackHeld, autoAtk, target);

    for (const k of ['secondary', 'mobility', 'special', 'ultimate', 'swap', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5']) pressed[k] = false;
  }

  function lookDir(p) {
    return { dx: Math.cos(p.angle), dy: Math.sin(p.angle) };
  }

  /* ----- Rōnin ----- */
  function useEnergy(p, cost) {
    if (p.energy < cost) { p.energyFlash = 0.4; Sfx.empty(); return false; }
    p.energy -= cost;
    return true;
  }

  function updateSamurai(p, st, dt, attackHeld, autoAtk, target) {
    p.energy = Math.min(st.energyMax, p.energy + st.energyRegen * dt);
    p.atkT -= dt;

    let wantAttack = attackHeld;
    if (autoAtk && target) {
      const d = Math.hypot(target.x - p.x, target.y - p.y) - target.r;
      if (d < st.swordRange * 1.05) wantAttack = true;
    }
    if (wantAttack && p.atkT <= 0 && !p.dash && p.ultT <= 0) swing(p, st);

    p.pushCd = Math.max(0, (p.pushCd || 0) - dt);
    if (pressed.secondary && p.pushCd <= 0) push(p, st);
    if (pressed.mobility && st.dash && !p.dash) {
      if (useEnergy(p, st.dash.cost)) {
        const { mx, my } = moveInput();
        let dx = mx, dy = my;
        if (!dx && !dy) { const l = lookDir(p); dx = l.dx; dy = l.dy; }
        const l = Math.hypot(dx, dy); dx /= l; dy /= l;
        const dur = 0.16;
        p.dash = { t: dur, vx: dx * st.dash.dist / dur, vy: dy * st.dash.dist / dur, cut: st.dash.cut, stun: st.dash.stun, hit: new Set() };
        p.invuln = Math.max(p.invuln, dur + 0.08);
        Sfx.dash();
        for (let i = 0; i < 10; i++) particle(p.x, p.y, rand(-40, 40), rand(-40, 40), 0.4, 3, 'rgba(160,220,255,0.6)');
      }
    }
    p.stasisCd = Math.max(0, (p.stasisCd || 0) - dt);
    if (pressed.special && st.stasis && p.stasisT <= 0) {
      if (p.stasisCd > 0) Sfx.empty();
      else if (useEnergy(p, st.stasis.cost)) { p.stasisT = st.stasis.dur; p.stasisMax = st.stasis.dur; Sfx.stasis(); }
    }
    p.ultCd = Math.max(0, (p.ultCd || 0) - dt);
    if (pressed.ultimate && st.ult && p.ultT <= 0) {
      if (p.ultCd > 0) Sfx.empty();
      else if (useEnergy(p, st.ult.cost)) { p.ultT = st.ult.dur; p.ultMax = st.ult.dur; p.ultTick = 0; Sfx.ult(); shake(4); }
    }

    // Stase
    if (p.stasisT > 0) {
      p.stasisT -= dt;
      if (p.stasisT <= 0) p.stasisCd = st.stasis.cd;
      let caught = 0;
      const rad = st.stasis.radius;
      near(p.x, p.y, rad + 40, z => {
        if (dist2(z.x, z.y, p.x, p.y) < (rad + z.r * 0.5) * (rad + z.r * 0.5)) {
          caught++;
        }
      });
      if (st.stasis.drain) p.energy = Math.min(st.energyMax, p.energy + st.stasis.drain * Math.min(30, caught) * dt);
    }

    // Tempête de lames : tourbillon défensif à échelle humaine qui repousse et tranche les projectiles
    if (p.ultT > 0) {
      p.ultT -= dt;
      if (p.ultT <= 0) p.ultCd = st.ult.cd || 8;
      const rad = st.ult.radius;
      // Tranche les projectiles ennemis qui approchent
      for (const b of R.eproj) {
        if (b.friendly) continue;
        if (dist2(b.x, b.y, p.x, p.y) < (rad + 12) * (rad + 12)) {
          b.life = 0;
          for (let i = 0; i < 4; i++) particle(b.x, b.y, rand(-90, 90), rand(-90, 90), 0.22, 2, '#c8f4ff');
        }
      }
      // Particules d'étincelles et de souffle sur le cercle de lames
      if (Math.random() < 0.65) {
        const a = Math.random() * TAU, rr = rad * rand(0.65, 1.0);
        const tx = -Math.sin(a) * 140, ty = Math.cos(a) * 140;
        particle(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, tx, ty, 0.18, 2, 'rgba(195,240,255,0.75)');
      }
      p.ultTick -= dt;
      if (p.ultTick <= 0) {
        p.ultTick = 0.10;
        near(p.x, p.y, rad + 34, z => {
          const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
          if (d < rad + z.r) {
            const nx = dx / d, ny = dy / d;
            // Forte poussée défensive pour maintenir les zombies à distance du sabre
            const kb = (st.ult.kb * (1.15 - 0.35 * Math.min(1, d / rad))) / z.d.mass;
            z.kbx = nx * Math.max(Math.hypot(z.kbx, z.kby), kb);
            z.kby = ny * Math.max(Math.hypot(z.kbx, z.kby), kb);
            if (!z.d.boss) z.stun = Math.max(z.stun, 0.14);
            hitZombie(z, st.swordDmg * st.ult.mult, { canCrit: true, melee: true, silent: true });
          }
        });
        if (Math.random() < 0.45) Sfx.whirl();
      }
    }
  }

  function swing(p, st) {
    if (!useEnergy(p, st.swordCost)) {
      p.atkT = 0.16;
      return;
    }
    p.attackCount++;
    const whirl = st.whirlEvery && p.attackCount % st.whirlEvery === 0;
    const arc = whirl ? TAU : st.swordArc;
    const range = st.swordRange * (whirl ? 1.12 : 1);
    const mult = whirl ? (st.whirlMult || 1.25) : 1;
    p.atkT = st.swordCd;
    p.swingDir = -p.swingDir;
    p.swingT = whirl ? 0.24 : 0.16;
    p.swingDur = p.swingT;
    p.swingArc = arc;
    p.swingWhirl = whirl;
    p.swingAngle = p.angle;
    let hits = 0;
    near(p.x, p.y, range + 50, z => {
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d - z.r > range) return;
      if (!whirl && Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > arc / 2 + Math.atan2(z.r, Math.max(d, 1))) return;
      const kb = (whirl ? 180 : 115) / z.d.mass;
      hitZombie(z, st.swordDmg * mult, { kx: dx / (d || 1) * kb, ky: dy / (d || 1) * kb, canCrit: true, melee: true });
      hits++;
    });
    if (hits && st.leech) healPlayer(st.leech * Math.min(hits, st.leechCap || 4), false);
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
          const tgt = aimTarget();
          if (tgt) ra = Math.atan2(tgt.y - b.y, tgt.x - b.x);
        }
        b.vx = Math.cos(ra) * sp; b.vy = Math.sin(ra) * sp;
        b.friendly = true; b.life = 1.4;
        b.dmg = st.swordDmg * (st.deflect >= 3 ? 7 : 2 + 1.5 * (st.deflect - 1));
        for (let i = 0; i < 5; i++) particle(b.x, b.y, rand(-80, 80), rand(-80, 80), 0.25, 2, '#bff');
      }
    }
    // Lame d'air
    if (st.airWave && !whirl) {
      const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
      R.bullets.push({ kind: 'wave', x: p.x + dx * 20, y: p.y + dy * 20, px: p.x, py: p.y, vx: dx * 640, vy: dy * 640,
        r: st.airWave.big ? 32 : 22,
        dmg: st.swordDmg * st.airWave.dmg, pierce: st.airWave.pierce, life: st.airWave.big ? 0.68 : 0.55, hit: [], angle: p.angle });
    }
    if (whirl) Sfx.whirl(); else Sfx.slash();
  }

  function dashCut(p) {
    const st = R.st;
    near(p.x, p.y, 54, z => {
      if (p.dash.hit.has(z.id)) return;
      if (Math.hypot(z.x - p.x, z.y - p.y) < z.r + p.r + 16) {
        p.dash.hit.add(z.id);
        if (p.dash.stun) z.stun = Math.max(z.stun, p.dash.stun * (z.d.boss ? 0.4 : 1));
        hitZombie(z, st.swordDmg * p.dash.cut, { canCrit: true, melee: true });
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
      const f = P.force * (1 - 0.45 * d / P.range) / z.d.mass;
      z.kbx += dx / d * f; z.kby += dy / d * f;
      if (P.stun) z.stun = Math.max(z.stun, P.stun * (z.d.boss ? (P.stunBoss ? 0.6 : 0.3) : 1));
      hitZombie(z, P.dmg, { canCrit: false });
    });
    for (const b of R.eproj) {
      if (b.friendly) continue;
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d < P.range && (full || Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) < P.arc / 2 + 0.2)) b.life = 0;
    }
    R.fx.push({ kind: 'push', x: p.x, y: p.y, angle: p.angle, arc: P.arc, range: P.range, t: 0, dur: 0.35 });
    Sfx.push();
    shake(3);
  }

  /* ----- Soldat ----- */
  function bestWeapon(p, st) {
    for (let i = WEAPON_ORDER.length - 1; i >= 1; i--) {
      const k = WEAPON_ORDER[i];
      if (st.weapons[k].unlocked && p.ammo[k] > 0) return k;
    }
    return 'pistol';
  }

  function availableWeapons() {
    return WEAPON_ORDER.filter(k => R.st.weapons[k].unlocked);
  }

  function cycleWeapon(dir) {
    const list = availableWeapons().filter(k => R.p.ammo[k] > 0);
    if (list.length < 2) return;
    let i = list.indexOf(R.p.weapon);
    i = (i + dir + list.length) % list.length;
    R.p.weapon = list[i];
    Sfx.click();
  }

  function updateSoldier(p, st, dt, attackHeld, autoAtk, target) {
    p.fireT -= dt;
    p.rollCd = Math.max(0, p.rollCd - dt);
    p.adrenCd = Math.max(0, p.adrenCd - dt);
    p.turretCd = Math.max(0, p.turretCd - dt);
    p.nadeCd = Math.max(0, p.nadeCd - dt);
    p.adrenT = Math.max(0, p.adrenT - dt);

    // sélection d'arme
    for (let i = 0; i < 6; i++) {
      if (pressed['w' + i]) {
        const k = WEAPON_ORDER[i];
        if (st.weapons[k].unlocked && p.ammo[k] > 0) { p.weapon = k; Sfx.click(); }
      }
    }
    if (pressed.swap) cycleWeapon(1);

    const w = st.weapons[p.weapon];
    let wantFire = attackHeld;
    if (autoAtk && target) {
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      if (d < (w.range || 600) + 40) wantFire = true;
    }
    if (wantFire && p.fireT <= 0 && !p.dash) fire(p, st, w);

    if (pressed.secondary && st.grenades && p.nadeCd <= 0) {
      if (p.grenades > 0) throwGrenade(p, st); else Sfx.empty();
    }
    if (pressed.mobility && st.roll && p.rollCd <= 0 && !p.dash) {
      const { mx, my } = moveInput();
      let dx = mx, dy = my;
      if (!dx && !dy) { const l = lookDir(p); dx = l.dx; dy = l.dy; }
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      const dur = 0.26;
      p.dash = { t: dur, vx: dx * st.roll.dist / dur, vy: dy * st.roll.dist / dur, roll: true };
      p.invuln = Math.max(p.invuln, dur + 0.06);
      p.rollCd = st.roll.cd;
      Sfx.dash();
    }
    if (pressed.special && st.adren && p.adrenCd <= 0) {
      p.adrenT = st.adren.dur; p.adrenCd = st.adren.cd; Sfx.heal();
    }
    if (pressed.ultimate && st.turret && p.turretCd <= 0) {
      R.turrets.push({ x: p.x + Math.cos(p.angle) * 30, y: p.y + Math.sin(p.angle) * 30, t: st.turret.dur, max: st.turret.dur, fireT: 0, angle: p.angle });
      p.turretCd = st.turret.cd; Sfx.crate();
    }
  }

  function fire(p, st, w) {
    const k = p.weapon;
    if (!w.infinite && p.ammo[k] <= 0) { p.weapon = bestWeapon(p, st); return; }
    const rate = w.rate * (p.adrenT > 0 ? (st.adren.rateMult || 1.5) : 1);
    p.fireT = 1 / rate;
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    const mx = p.x + dx * 26 + -dy * 6, my = p.y + dy * 26 + dx * 6;
    if (k === 'flamer') {
      flameTick(p, w, mx, my);
      Sfx.flame();
    } else if (k === 'launcher') {
      const tx = p.aimX ?? p.x + dx * w.range, ty = p.aimY ?? p.y + dy * w.range;
      const d = Math.min(w.range, Math.max(80, Math.hypot(tx - p.x, ty - p.y)));
      R.bullets.push({ kind: 'shell', x: mx, y: my, px: mx, py: my, vx: dx * w.speed, vy: dy * w.speed, r: 6, dmg: w.dmg, radius: w.radius,
        life: d / w.speed, pierce: 0, hit: [] });
      p.muzzle = 0.08; p.recoil = 1;
      Sfx.thump();
    } else {
      const n = k === 'shotgun' ? w.pellets : w.count || 1;
      for (let i = 0; i < n; i++) {
        let a = p.angle;
        if (k === 'shotgun') a += (i / (n - 1) - 0.5) * w.spread + rand(-0.04, 0.04);
        else if (n > 1) a += (i - (n - 1) / 2) * 0.12 + rand(-w.spread, w.spread) * 0.5;
        else a += rand(-w.spread, w.spread);
        const sp = w.speed * (k === 'shotgun' ? rand(0.85, 1.1) : 1);
        R.bullets.push({ kind: 'b', x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: k === 'shotgun' ? 3 : 2.5,
          dmg: w.dmg, pierce: w.pierce || 0, life: w.range / sp, hit: [], color: k === 'pistol' ? '#ffe9a0' : k === 'shotgun' ? '#ffcf70' : '#fff3c0' });
      }
      p.muzzle = 0.05; p.recoil = k === 'shotgun' ? 1.6 : 0.6;
      if (k === 'shotgun') { Sfx.shotgun(); shake(2.5); }
      else if (k === 'pistol') Sfx.shot();
      else Sfx.rifle();
      // douille
      particle(p.x + -dy * 8, p.y + dx * 8, -dy * rand(60, 120) + rand(-20, 20), dx * rand(60, 120) + rand(-20, 20), 0.5, 1.6, '#d8b048', 'shell');
    }
    if (!w.infinite) {
      p.ammo[k]--;
      if (p.ammo[k] <= 0) { p.ammo[k] = 0; p.weapon = bestWeapon(p, st); Sfx.empty(); }
    }
  }

  function flameTick(p, w, mx, my) {
    const range = w.range;
    near(p.x, p.y, range + 40, z => {
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d - z.r > range) return;
      if (Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > w.arc / 2 + Math.atan2(z.r, Math.max(d, 1))) return;
      hitZombie(z, w.dmg, { canCrit: false, silent: true });
      z.burn = 2.5; z.burnDps = Math.max(z.burnDps, w.burn);
    });
    for (let i = 0; i < 2; i++) {
      const a = p.angle + rand(-w.arc / 2, w.arc / 2) * 0.8, sp = rand(range * 1.6, range * 2.6);
      particle(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.45), rand(5, 9), null, 'fire');
    }
  }

  function throwGrenade(p, st) {
    p.grenades--;
    p.nadeCd = 0.35;
    const tx = p.aimX ?? p.x + Math.cos(p.angle) * 300, ty = p.aimY ?? p.y + Math.sin(p.angle) * 300;
    let dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    const maxD = 420;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
    if (d < 60) { dx = Math.cos(p.angle) * 60; dy = Math.sin(p.angle) * 60; }
    R.grenades.push({ sx: p.x, sy: p.y, x: p.x, y: p.y, tx: p.x + dx, ty: p.y + dy, t: 0, dur: 0.55, fuse: 0.45, h: 0,
      dmg: st.grenades.dmg, radius: st.grenades.radius, frag: st.grenades.frag });
    Sfx.dash();
  }

  /* ---------------- Dégâts ---------------- */
  function hitZombie(z, dmg, o = {}) {
    if (z.dead) return;
    const st = R.st;
    let crit = false;
    if (o.canCrit && Math.random() < st.crit) { dmg *= st.critMult; crit = true; }
    if (z.inStasis && st.stasis) dmg *= 1 + st.stasis.vuln;
    z.hp -= dmg;
    z.flash = 0.08;
    if (o.kx) { z.kbx += o.kx; z.kby += o.ky; }
    if (!o.silent) {
      for (let i = 0; i < (crit ? 5 : 2); i++) particle(z.x, z.y, rand(-90, 90), rand(-90, 90), 0.35, rand(2, 3.5), '#6a0f12', 'blood');
      if (o.melee) Sfx.hit();
    }
    if (settings.dmgNumbers && (!o.silent || Math.random() < 0.12)) addText(z.x + rand(-8, 8), z.y - z.r, Math.round(dmg).toString(), crit ? '#ffd23a' : '#ffffff', crit ? 1.25 : 1);
    const execThresh = z.d.boss ? (st.executeBoss || 0) : (st.execute || 0);
    if (execThresh && z.hp > 0 && z.hp < z.maxHp * execThresh) {
      z.hp = 0;
      addText(z.x, z.y - z.r - 10, 'ACHEVÉ', '#ff6a6a', 1);
    }
    if (z.hp <= 0) killZombie(z);
  }

  function killZombie(z) {
    if (z.dead) return;
    z.dead = true;
    R.kills++;
    R.killedWave++;
    R.lastKillT = R.t;
    const st = R.st;
    const souls = z.d.souls * st.soulMult;
    // âmes
    const n = Math.min(8, Math.max(1, Math.round(souls / 6)));
    let left = souls;
    for (let i = 0; i < n; i++) {
      const v = i === n - 1 ? left : souls / n;
      left -= v;
      dropOrb('soul', z.x, z.y, v);
    }
    if (Math.random() < st.healChance || (z.d.boss)) dropOrb('heal', z.x, z.y, z.d.boss ? 50 : st.healAmt);
    if (R.cls === 'soldier' && st.scavenge && Math.random() < st.scavenge && availableWeapons().length > 1) dropOrb('ammo', z.x, z.y, 0.25);
    if (R.cls === 'soldier' && z.d.boss) for (let i = 0; i < 2; i++) spawnCrate(z.x + rand(-40, 40), z.y + rand(-40, 40), true);
    if (st.energyOnKill) R.p.energy = Math.min(st.energyMax, R.p.energy + st.energyOnKill);
    // sang
    R.decals.push({ x: z.x, y: z.y, r: z.r * rand(1.1, 1.8), rot: Math.random() * TAU, a: 0.75, kind: 'blood', seed: Math.random() });
    if (R.decals.length > 380) R.decals.splice(0, R.decals.length - 380);
    for (let i = 0; i < 8; i++) particle(z.x, z.y, rand(-140, 140), rand(-140, 140), rand(0.3, 0.6), rand(2, 4), '#5a0b0e', 'blood');
    if (z.d.explode) {
      // le Gonflé enfle une demi-seconde avant d'exploser : on peut s'écarter
      R.bombs.push({ x: z.x, y: z.y, t: 0.55, max: 0.55, r: z.d.explode.r, dmg: z.d.explode.dmg * waveDmgScale(R.wave) });
    }
    if (z.d.boss) { shake(14); R.banner = { text: 'COLOSSE ABATTU', sub: '+' + Math.round(souls) + ' âmes', t: 0, dur: 2.5 }; }
  }

  function hurtPlayer(dmg, srcX, srcY) {
    const p = R.p, st = R.st;
    if (R.over || p.invuln > 0) return;
    if (st.dodge && Math.random() < st.dodge) { addText(p.x, p.y - 26, 'ESQUIVE', '#9fe8ff', 1); p.invuln = 0.15; return; }
    dmg *= st.dmgTaken;
    if (p.ultT > 0 && st.ult) dmg *= st.ult.dmgTakenMult || 0.4;
    p.hp -= dmg;
    p.hurtT = 0.25;
    Sfx.hurt();
    shake(Math.min(8, 2 + dmg * 0.3));
    if (srcX !== undefined) {
      const dx = p.x - srcX, dy = p.y - srcY, d = Math.hypot(dx, dy) || 1;
      p.x += dx / d * 4; p.y += dy / d * 4;
    }
    if (p.hp <= 0) {
      if (st.second && !p.secondUsed) {
        p.secondUsed = true;
        p.hp = st.maxHp;
        p.invuln = 2.4;
        near(p.x, p.y, 350, z => {
          const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
          z.kbx += dx / d * 1050 / z.d.mass; z.kby += dy / d * 1050 / z.d.mass; z.stun = Math.max(z.stun, 1.5);
        });
        R.fx.push({ kind: 'push', x: p.x, y: p.y, angle: 0, arc: TAU, range: 350, t: 0, dur: 0.55, color: '255,150,60' });
        R.banner = { text: 'SECOND SOUFFLE', sub: '100 % PV', t: 0, dur: 2 };
        Sfx.push(); shake(10);
        return;
      }
      p.hp = 0;
      gameOver();
    }
  }

  function healPlayer(v, show = true) {
    const p = R.p;
    const before = p.hp;
    p.hp = Math.min(R.st.maxHp, p.hp + v);
    if (show && p.hp > before) addText(p.x, p.y - 28, '+' + Math.round(p.hp - before) + ' PV', '#7dff8a', 1);
  }

  function explode(x, y, radius, dmg, friendly, scale = 1) {
    near(x, y, radius + 30, z => {
      const dx = z.x - x, dy = z.y - y, d = Math.hypot(dx, dy) || 1;
      if (d - z.r > radius) return;
      const f = 1 - 0.5 * Math.min(1, d / radius);
      hitZombie(z, dmg * f * (friendly ? 1 : 1.5), { kx: dx / d * 380 * f / z.d.mass, ky: dy / d * 380 * f / z.d.mass, canCrit: friendly });
    });
    if (!friendly) {
      const p = R.p;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < radius + p.r) hurtPlayer(dmg * (1 - 0.4 * d / radius), x, y);
    }
    R.fx.push({ kind: 'boom', x, y, r: radius, t: 0, dur: 0.4, color: friendly ? null : '170,200,60' });
    R.decals.push({ x, y, r: radius * 0.55, rot: Math.random() * TAU, a: 0.6, kind: friendly ? 'scorch' : 'goo', seed: Math.random() });
    const n = Math.round(14 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(80, 320) * Math.sqrt(scale);
      particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), rand(4, 9) * Math.sqrt(scale), null, friendly ? 'fire' : 'goo');
    }
    for (let i = 0; i < 6 * scale; i++) particle(x, y, rand(-60, 60), rand(-60, 60), rand(0.8, 1.4), rand(10, 18), 'rgba(60,60,60,0.5)', 'smoke');
    Sfx.boom();
    shake(friendly ? 5 * Math.sqrt(scale) : 6);
  }

  /* ---------------- Zombies ---------------- */
  function updateZombies(dt) {
    const p = R.p;
    const zs = R.zombies;
    for (const z of zs) { z.slowF = 1; z.inStasis = false; }
    gridBuild();
    if (R.cls === 'samurai' && p.stasisT > 0) {
      const rad = R.st.stasis.radius;
      const fullStop = R.st.stasis.slow >= 1;
      near(p.x, p.y, rad + 40, z => {
        if (dist2(z.x, z.y, p.x, p.y) < (rad + z.r * 0.5) * (rad + z.r * 0.5)) {
          z.slowF = Math.min(z.slowF, 1 - R.st.stasis.slow * (z.d.boss ? (fullStop ? 0.85 : 0.6) : 1));
          z.inStasis = true;
        }
      });
    }

    for (const z of zs) {
      if (z.dead) continue;
      const sf = z.slowF;
      const zdt = dt * sf;
      z.flash = Math.max(0, z.flash - dt);
      z.spawnFade = Math.min(1, z.spawnFade + dt * 2);
      if (z.burn > 0) {
        z.burn -= dt;
        z.hp -= z.burnDps * dt;
        if (Math.random() < 0.25) particle(z.x + rand(-z.r, z.r) * 0.5, z.y + rand(-z.r, z.r) * 0.5, rand(-20, 20), rand(-40, -10), 0.4, rand(3, 6), null, 'fire');
        if (z.hp <= 0) { killZombie(z); continue; }
        if (z.burn <= 0) z.burnDps = 0;
      }
      const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      // un zombie resté trop loin trop longtemps revient près du joueur
      if (d > 1300) { z.far = (z.far || 0) + dt; if (z.far > 12) { const s = spawnPoint(); z.x = s.x; z.y = s.y; z.far = 0; } } else z.far = 0;
      if (sf > 0) z.wob += zdt * (z.speed / 12);
      if (z.stun > 0) z.stun -= dt;
      let vx = 0, vy = 0;
      if (z.stun <= 0) {
        let sp = z.speed;
        const R0 = z.d.ranged;
        if (R0) {
          if (d < R0.keep) sp = -z.speed * 0.6;
          else if (d < R0.range) sp = 0;
          z.spitT -= zdt;
          if (z.spitT <= 0 && d < R0.range + 40) {
            z.spitT = R0.cd * rand(0.85, 1.15);
            R.eproj.push({ x: z.x + nx * z.r, y: z.y + ny * z.r, vx: nx * R0.speed, vy: ny * R0.speed, r: 7, dmg: R0.dmg * waveDmgScale(R.wave), life: 2.2, friendly: false });
            Sfx.spit();
          }
        }
        // le boss frappe le sol
        if (z.d.boss) {
          if (z.windup > 0) {
            z.windup -= zdt;
            sp = 0;
            if (z.windup <= 0) {
              R.fx.push({ kind: 'boom', x: z.x, y: z.y, r: 140, t: 0, dur: 0.5, color: '150,100,180' });
              if (Math.hypot(p.x - z.x, p.y - z.y) < 140 + p.r) hurtPlayer(z.dmg * 0.8, z.x, z.y);
              shake(9); Sfx.boom();
            }
          } else {
            z.slamT -= zdt;
            if (z.slamT <= 0 && d < 160) { z.slamT = 3.8; z.windup = 0.8; Sfx.groan(); }
          }
        }
        vx = nx * sp; vy = ny * sp;
        // Contournement fluide des murs de maisons jusqu'au point de passage (brèche)
        if (z.detour && z.detour.t > 0 && sp > 0) {
          z.detour.t -= zdt;
          const dtx = z.detour.tx - z.x, dty = z.detour.ty - z.y;
          const dtd = Math.hypot(dtx, dty);
          if (dtd < 16) {
            z.detour = null;
          } else {
            vx = (dtx / dtd) * sp;
            vy = (dty / dtd) * sp;
          }
        }
        // contact → attaque
        if (d < z.r + p.r + 5) {
          vx = 0; vy = 0;
          z.atkT -= zdt;
          if (z.atkT <= 0) {
            z.atkT = z.d.atkCd;
            if (z.d.explode) { z.hp = 0; killZombie(z); continue; }
            hurtPlayer(z.dmg, z.x, z.y);
          }
        } else if (z.atkT < z.d.atkCd * 0.4) z.atkT += dt * 0.5;
      }
      z.x += (vx * sf + z.kbx) * dt;
      z.y += (vy * sf + z.kby) * dt;
      const decay = Math.exp(-5 * dt);
      z.kbx *= decay; z.kby *= decay;
      if (sf > 0.01 && z.stun <= 0) {
        const ta = Math.atan2(vy || ny, vx || nx);
        z.angle += angDiff(ta, z.angle) * Math.min(1, dt * 8 * sf);
      }
    }

    // séparation entre zombies
    for (const z of zs) {
      if (z.dead) continue;
      near(z.x, z.y, z.r + 26, o => {
        if (o.id <= z.id) return;
        const dx = o.x - z.x, dy = o.y - z.y;
        const m = z.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= m * m) return;
        const d = Math.sqrt(d2) || 0.01;
        const ov = (m - d) * 0.5;
        const nx = d > 0.01 ? dx / d : Math.random() - 0.5, ny = d > 0.01 ? dy / d : Math.random() - 0.5;
        const wz = o.d.mass / (z.d.mass + o.d.mass), wo = 1 - wz;
        // un zombie figé ne bouge plus
        const fz = z.slowF < 0.02 ? 0 : 1, fo = o.slowF < 0.02 ? 0 : 1;
        z.x -= nx * ov * wz * 2 * fz;
        z.y -= ny * ov * wz * 2 * fz;
        o.x += nx * ov * wo * 2 * fo;
        o.y += ny * ov * wo * 2 * fo;
        // transfert de recul : les zombies projetés bousculent les autres
        if (Math.abs(z.kbx) + Math.abs(z.kby) > 120) {
          o.kbx += z.kbx * 0.25; o.kby += z.kby * 0.25;
          z.kbx *= 0.85; z.kby *= 0.85;
        }
      });
    }
    // obstacles, bords et joueur
    for (const z of zs) {
      if (z.dead) continue;
      const hit = collideObstacles(z, z.r);
      if (hit && z.slowF > 0.01) {
        const o = hit.o;
        let sx = 0, sy = 0;
        if (o && o.kind === 'rect') {
          // Choisit l'extrémité ouverte du mur (brèche) la plus rapide vers le joueur
          let tx = z.x, ty = z.y;
          if (Math.abs(hit.ny) >= Math.abs(hit.nx)) {
            const x1 = o.x - o.hw - z.r - 14, x2 = o.x + o.hw + z.r + 14;
            let dir;
            if (o.blockMin && !o.blockMax) dir = 1;
            else if (o.blockMax && !o.blockMin) dir = -1;
            else {
              const c1 = Math.abs(z.x - x1) + Math.hypot(p.x - x1, p.y - o.y);
              const c2 = Math.abs(z.x - x2) + Math.hypot(p.x - x2, p.y - o.y);
              dir = c1 <= c2 ? -1 : 1;
            }
            sx = dir;
            tx = dir < 0 ? x1 : x2;
            ty = o.y - Math.sign(hit.ny || -1) * (o.hh + z.r + 16);
          } else {
            const y1 = o.y - o.hh - z.r - 14, y2 = o.y + o.hh + z.r - 14 + 28;
            let dir;
            if (o.blockMin && !o.blockMax) dir = 1;
            else if (o.blockMax && !o.blockMin) dir = -1;
            else {
              const c1 = Math.abs(z.y - y1) + Math.hypot(p.x - o.x, p.y - y1);
              const c2 = Math.abs(z.y - y2) + Math.hypot(p.x - o.x, p.y - y2);
              dir = c1 <= c2 ? -1 : 1;
            }
            sy = dir;
            tx = o.x - Math.sign(hit.nx || -1) * (o.hw + z.r + 16);
            ty = dir < 0 ? y1 : y2;
          }
          if (!z.detour || z.detour.t <= 0) {
            z.detour = { tx, ty, t: 2.6, oid: o.id };
          }
        } else {
          const dx = p.x - z.x, dy = p.y - z.y;
          const side = (hit.nx * dy - hit.ny * dx) > 0 ? 1 : -1;
          sx = -hit.ny * side;
          sy = hit.nx * side;
        }
        z.x += sx * z.speed * z.slowF * dt * 0.85;
        z.y += sy * z.speed * z.slowF * dt * 0.85;
        collideObstacles(z, z.r);
      }
      z.x = clamp(z.x, z.r, ARENA - z.r); z.y = clamp(z.y, z.r, ARENA - z.r);
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy), m = z.r + p.r;
      if (d < m && d > 0.01 && !p.dash) {
        const ov = m - d;
        z.x += dx / d * ov * 0.85; z.y += dy / d * ov * 0.85;
        p.x -= dx / d * ov * 0.15; p.y -= dy / d * ov * 0.15;
      }
    }
    if (zs.some(z => z.dead)) R.zombies = zs.filter(z => !z.dead);
  }

  /* ---------------- Projectiles ---------------- */
  function updateBullets(dt) {
    const bs = R.bullets;
    for (const b of bs) {
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      if (b.kind === 'shell') {
        if (b.life <= 0) { explode(b.x, b.y, b.radius, b.dmg, true); continue; }
      }
      if (b.life <= 0) continue;
      if (b.x < 0 || b.y < 0 || b.x > ARENA || b.y > ARENA) { b.life = 0; continue; }
      if (b.kind !== 'wave' && pointInObstacle(b.x, b.y)) {
        if (b.kind === 'shell') explode(b.x, b.y, b.radius, b.dmg, true);
        else for (let i = 0; i < 3; i++) particle(b.x, b.y, rand(-60, 60), rand(-60, 60), 0.2, 1.5, '#ffd27a');
        b.life = 0; continue;
      }
      // collision segment / cercle
      const sx = b.px, sy = b.py, ex = b.x, ey = b.y;
      const segx = ex - sx, segy = ey - sy, segL2 = segx * segx + segy * segy || 1;
      near((sx + ex) / 2, (sy + ey) / 2, Math.sqrt(segL2) / 2 + b.r + 40, z => {
        if (b.life <= 0 || b.hit.includes(z.id)) return;
        let t = ((z.x - sx) * segx + (z.y - sy) * segy) / segL2;
        t = clamp(t, 0, 1);
        const cx = sx + segx * t, cy = sy + segy * t;
        const rr = z.r + b.r;
        if (dist2(cx, cy, z.x, z.y) > rr * rr) return;
        if (b.kind === 'shell') { b.x = cx; b.y = cy; explode(cx, cy, b.radius, b.dmg, true); b.life = 0; return; }
        b.hit.push(z.id);
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const kb = (b.kind === 'wave' ? 70 : 45) / z.d.mass;
        hitZombie(z, b.dmg, { kx: b.vx / sp * kb, ky: b.vy / sp * kb, canCrit: true });
        if (b.pierce > 0) b.pierce--; else b.life = 0;
      });
    }
    R.bullets = bs.filter(b => b.life > 0);

    // projectiles ennemis (et renvoyés)
    const p = R.p;
    for (const b of R.eproj) {
      let f = 1;
      if (!b.friendly && R.cls === 'samurai' && p.stasisT > 0 && dist2(b.x, b.y, p.x, p.y) < R.st.stasis.radius ** 2) f = 1 - R.st.stasis.slow * 0.9;
      b.x += b.vx * dt * f; b.y += b.vy * dt * f;
      b.life -= dt;
      if (b.life <= 0) continue;
      if (pointInObstacle(b.x, b.y)) { b.life = 0; splat(b.x, b.y); continue; }
      if (b.friendly) {
        near(b.x, b.y, 40, z => {
          if (b.life <= 0) return;
          if (dist2(z.x, z.y, b.x, b.y) < (z.r + b.r) ** 2) { hitZombie(z, b.dmg, { canCrit: true }); b.life = 0; splat(b.x, b.y); }
        });
      } else if (dist2(p.x, p.y, b.x, b.y) < (p.r + b.r) ** 2) {
        hurtPlayer(b.dmg, b.x - b.vx, b.y - b.vy);
        b.life = 0; splat(b.x, b.y);
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
          explode(g.x, g.y, g.radius, g.dmg, true, g.mini ? 0.5 : 1.3);
          if (g.frag) {
            for (let i = 0; i < g.frag; i++) {
              const a = i / g.frag * TAU + rand(-0.3, 0.3), dd = rand(60, 120);
              R.grenades.push({ sx: g.x, sy: g.y, x: g.x, y: g.y, tx: g.x + Math.cos(a) * dd, ty: g.y + Math.sin(a) * dd, t: 0, dur: 0.3, fuse: 0.15 + i * 0.06, h: 0,
                dmg: g.dmg * 0.4, radius: g.radius * 0.55, frag: 0, mini: true });
            }
          }
        }
      }
    }
    R.grenades = R.grenades.filter(g => !g.done);

    // tourelles
    for (const t of R.turrets) {
      t.t -= dt;
      t.fireT -= dt;
      let best = null, bd = 480 * 480;
      near(t.x, t.y, 480, z => { const d = dist2(z.x, z.y, t.x, t.y); if (d < bd) { bd = d; best = z; } });
      if (best) {
        const ta = Math.atan2(best.y - t.y, best.x - t.x);
        t.angle += angDiff(ta, t.angle) * Math.min(1, dt * 12);
        if (t.fireT <= 0 && Math.abs(angDiff(ta, t.angle)) < 0.3) {
          t.fireT = 1 / R.st.turret.rate;
          const a = t.angle + rand(-0.05, 0.05);
          R.bullets.push({ kind: 'b', x: t.x + Math.cos(a) * 18, y: t.y + Math.sin(a) * 18, px: t.x, py: t.y, vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000,
            r: 2.5, dmg: R.st.turret.dmg, pierce: 0, life: 0.55, hit: [], color: '#9fe8ff' });
          t.muzzle = 0.05;
          Sfx.rifle();
        }
      }
      t.muzzle = Math.max(0, (t.muzzle || 0) - dt);
    }
    R.turrets = R.turrets.filter(t => t.t > 0);

    for (const b of R.bombs) {
      b.t -= dt;
      if (b.t <= 0) explode(b.x, b.y, b.r, b.dmg, false);
    }
    R.bombs = R.bombs.filter(b => b.t > 0);
  }

  function splat(x, y) {
    for (let i = 0; i < 6; i++) particle(x, y, rand(-70, 70), rand(-70, 70), 0.35, rand(2, 4), null, 'goo');
  }

  /* ---------------- Objets au sol ---------------- */
  function dropOrb(kind, x, y, v) {
    if (kind === 'soul' && R.orbs.length > 350) { gainSouls(v); return; }
    const a = Math.random() * TAU, sp = rand(40, 120);
    R.orbs.push({ kind, x, y, v, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: kind === 'soul' ? 40 : 25 });
  }

  function spawnCrate(x, y, big) {
    x = clamp(x, 60, ARENA - 60); y = clamp(y, 60, ARENA - 60);
    for (let i = 0; i < 6 && pointInObstacle(x, y); i++) { x += rand(-60, 60); y += rand(-60, 60); }
    const c = { x, y, t: 0, big: !!big, r: 16 };
    collideObstacles(c, 22);
    R.crates.push(c);
  }

  function openCrate(c) {
    const p = R.p, st = R.st;
    const list = availableWeapons().filter(k => k !== 'pistol');
    const msgs = [];
    const giveAmmo = (k, f) => {
      const w = st.weapons[k];
      const before = p.ammo[k];
      p.ammo[k] = Math.min(w.cap, p.ammo[k] + Math.max(1, Math.round(w.crate * f)));
      const got = p.ammo[k] - before;
      if (got > 0) msgs.push('+' + got + ' ' + WEAPON_NAMES[k]);
      if (p.weapon === 'pistol' && got > 0) p.weapon = k;
    };
    if (list.length) {
      // favorise les armes les moins approvisionnées
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
      healPlayer(st.medHeal, false);
      if (p.hp > before) msgs.push('+' + Math.round(p.hp - before) + ' PV');
    }
    if (st.grenades && (Math.random() < 0.45 || c.big) && p.grenades < st.grenades.max) {
      const n = c.big ? 2 : 1;
      const before = p.grenades;
      p.grenades = Math.min(st.grenades.max, p.grenades + n);
      msgs.push('+' + (p.grenades - before) + ' grenade' + (p.grenades - before > 1 ? 's' : ''));
    }
    if (!msgs.length) {
      const v = Math.round((3 + R.wave) * st.soulMult);
      gainSouls(v);
      msgs.push('+' + v + ' âmes');
    }
    msgs.forEach((m, i) => addText(c.x, c.y - 20 - i * 16, m, '#ffd86a', 1.05, 1.4));
    Sfx.crate();
  }

  function updatePickups(dt) {
    const p = R.p, st = R.st;
    for (const o of R.orbs) {
      o.t += dt;
      o.life -= dt;
      const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy) || 1;
      const mag = o.kind === 'soul' ? st.magnet : st.magnet * 0.6;
      if (d < mag || o.attract) {
        o.attract = true;
        const sp = 300 + o.t * 300;
        o.vx = dx / d * sp; o.vy = dy / d * sp;
      } else {
        const dec = Math.exp(-4 * dt); o.vx *= dec; o.vy *= dec;
      }
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (d < p.r + 8) {
        o.life = 0;
        if (o.kind === 'soul') { gainSouls(o.v); Sfx.pickup(); }
        else if (o.kind === 'heal') { healPlayer(o.v); Sfx.heal(); }
        else if (o.kind === 'ammo') {
          const list = availableWeapons().filter(k => k !== 'pistol');
          if (list.length) {
            const k = list[(Math.random() * list.length) | 0];
            const w = st.weapons[k];
            const g = Math.max(1, Math.round(w.crate * o.v));
            p.ammo[k] = Math.min(w.cap, p.ammo[k] + g);
            addText(p.x, p.y - 30, '+' + g + ' ' + WEAPON_NAMES[k], '#ffd86a', 0.9);
            if (p.weapon === 'pistol') p.weapon = k;
          }
          Sfx.pickup();
        }
      }
    }
    R.orbs = R.orbs.filter(o => o.life > 0);

    if (R.cls === 'soldier') {
      R.crateT -= dt;
      if (R.crateT <= 0) {
        R.crateT = st.crateInterval * rand(0.85, 1.15);
        if (R.crates.length < 5) {
          const a = Math.random() * TAU, d = rand(280, 750);
          spawnCrate(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, false);
        }
      }
      for (const c of R.crates) {
        c.t += dt;
        if (c.t > 0.6 && Math.hypot(p.x - c.x, p.y - c.y) < p.r + 24) { c.opened = true; openCrate(c); }
      }
      R.crates = R.crates.filter(c => !c.opened);
    }
  }

  /* ---------------- Effets ---------------- */
  function particle(x, y, vx, vy, life, size, color, kind) {
    if (R.particles.length > 1400) return;
    R.particles.push({ x, y, vx, vy, life, max: life, size, color, kind: kind || 'dot' });
  }

  function addText(x, y, txt, color, scale = 1, dur = 0.8) {
    if (R.texts.length > 120) R.texts.shift();
    R.texts.push({ x, y, txt, color, scale, t: 0, dur });
  }

  function shake(v) { if (settings.shake) R.cam.shake = Math.min(18, Math.max(R.cam.shake, v)); }

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
  }

  /* ---------------- Fin de partie ---------------- */
  function gameOver() {
    if (R.over) return;
    R.over = true;
    R.overT = 0;
    Sfx.death();
    shake(12);
    for (let i = 0; i < 30; i++) particle(R.p.x, R.p.y, rand(-200, 200), rand(-200, 200), rand(0.4, 1), rand(2, 5), '#7a0f12', 'blood');
  }

  function quitRun() {
    if (!R) return null;
    const sum = summary();
    R = null;
    paused = false;
    return sum;
  }

  function summary() {
    return { cls: R.cls, wave: R.wave, kills: R.kills, souls: Math.round(R.souls), time: R.t,
      cleared: R.phase === 'break' ? R.wave : R.wave - 1, startWave: R.startWave };
  }

  /* ---------------- Pas de simulation ---------------- */
  function step(dt) {
    if (!R) return;
    if (R.over) {
      R.overT += dt;
      R.slowmo = Math.max(0.15, 1 - R.overT);
      dt *= R.slowmo;
      updateZombiesIdle(dt);
      updateFx(dt);
      if (R.overT > 1.8 && !R.endSent) {
        R.endSent = true;
        const sum = summary();
        hooks.onEnd && hooks.onEnd(sum);
      }
      return;
    }
    R.t += dt;
    updateWaves(dt);
    updatePlayer(dt);
    updateZombies(dt);
    updateBullets(dt);
    updatePickups(dt);
    updateFx(dt);
    R.cam.shake *= Math.exp(-8 * dt);
  }

  function updateZombiesIdle(dt) {
    for (const z of R.zombies) z.wob += dt * 2;
  }

  /* ---------------- Rendu ---------------- */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, window.innerWidth || 800);
    H = Math.max(240, window.innerHeight || 600);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    zoom = clamp(Math.sqrt(W * H) / 720, 0.65, 1.3);
  }

  function render() {
    if (!R) return;
    const p = R.p;
    // caméra : suit le joueur, légère avance vers la visée
    const lead = 40;
    const tx = p.x + Math.cos(p.angle) * lead, ty = p.y + Math.sin(p.angle) * lead;
    R.cam.x += (tx - R.cam.x) * 0.12;
    R.cam.y += (ty - R.cam.y) * 0.12;
    const sk = R.cam.shake;
    const cx = R.cam.x + (sk ? rand(-sk, sk) : 0), cy = R.cam.y + (sk ? rand(-sk, sk) : 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0f0b';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    const vx0 = cx - W / 2 / zoom - 80, vx1 = cx + W / 2 / zoom + 80, vy0 = cy - H / 2 / zoom - 80, vy1 = cy + H / 2 / zoom + 80;
    const vis = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

    // sol
    if (!groundPattern) groundPattern = ctx.createPattern(Sprites.groundTile, 'repeat');
    ctx.fillStyle = groundPattern;
    ctx.fillRect(Math.max(0, vx0), Math.max(0, vy0), Math.min(ARENA, vx1) - Math.max(0, vx0), Math.min(ARENA, vy1) - Math.max(0, vy0));

    // chaussées délabrées entre les pâtés de maisons
    ctx.save();
    ctx.fillStyle = 'rgba(22,22,24,0.42)';
    for (const lane of [625, 1200, 1775]) {
      if (lane + 65 > vx0 && lane - 65 < vx1) ctx.fillRect(lane - 56, Math.max(0, vy0), 112, Math.min(ARENA, vy1) - Math.max(0, vy0));
      if (lane + 65 > vy0 && lane - 65 < vy1) ctx.fillRect(Math.max(0, vx0), lane - 56, Math.min(ARENA, vx1) - Math.max(0, vx0), 112);
    }
    ctx.strokeStyle = 'rgba(180,155,95,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([22, 26]);
    for (const lane of [625, 1200, 1775]) {
      ctx.beginPath();
      ctx.moveTo(lane, 40); ctx.lineTo(lane, ARENA - 40);
      ctx.moveTo(40, lane); ctx.lineTo(ARENA - 40, lane);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // sols intérieurs des maisons en ruine
    if (R.floors) {
      for (const fl of R.floors) {
        if (!vis(fl.x, fl.y, Math.max(fl.w, fl.h))) continue;
        ctx.drawImage(fl.img, fl.x - fl.w / 2, fl.y - fl.h / 2);
      }
    }

    // bordure de l'arène
    ctx.strokeStyle = '#3d2f22'; ctx.lineWidth = 14;
    ctx.strokeRect(-7, -7, ARENA + 14, ARENA + 14);
    ctx.strokeStyle = '#6b5638'; ctx.lineWidth = 3; ctx.setLineDash([18, 10]);
    ctx.strokeRect(-2, -2, ARENA + 4, ARENA + 4);
    ctx.setLineDash([]);

    // traces au sol
    for (const d of R.decals) {
      if (!vis(d.x, d.y, d.r)) continue;
      ctx.save();
      ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      ctx.globalAlpha = Math.max(0, d.a);
      if (d.kind === 'blood') {
        ctx.fillStyle = '#3d0709';
        ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#520a0d';
        ctx.beginPath(); ctx.arc(d.r * 0.9, d.r * 0.2, d.r * 0.25, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(-d.r * 0.7, -d.r * 0.5, d.r * 0.18, 0, TAU); ctx.fill();
      } else if (d.kind === 'goo') {
        ctx.fillStyle = 'rgba(90,120,30,0.8)';
        ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.8, 0, 0, TAU); ctx.fill();
      } else {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, d.r);
        g.addColorStop(0, 'rgba(10,8,6,0.9)'); g.addColorStop(1, 'rgba(10,8,6,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, d.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // obstacles (bas)
    for (const o of R.obstacles) {
      if (!vis(o.x, o.y, o.reach + 60)) continue;
      if (o.trunk) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(o.x + 10, o.y + 12, 40, 34, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3b2a1c'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#21170f'; ctx.lineWidth = 2; ctx.stroke();
      } else if (o.img) {
        ctx.drawImage(o.img, o.x - o.img.width / 2, o.y - o.img.height / 2);
      }
    }

    // stase (sol)
    if (R.cls === 'samurai' && p.stasisT > 0) drawStasis(p);
    // Gonflés sur le point d'exploser
    for (const b of R.bombs) {
      const k = 1 - b.t / b.max;
      ctx.fillStyle = 'rgba(160,200,40,' + (0.1 + 0.2 * k) + ')';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(200,240,80,' + (0.4 + 0.4 * Math.sin(k * 30)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#b6c25e';
      ctx.beginPath(); ctx.arc(b.x, b.y, 16 + 10 * k + Math.sin(k * 40) * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d9e07a';
      ctx.beginPath(); ctx.arc(b.x - 4, b.y - 4, 6 + 4 * k, 0, TAU); ctx.fill();
    }
    // zone du coup du Colosse
    for (const z of R.zombies) {
      if (!z.windup || z.windup <= 0 || z.dead) continue;
      const k = 1 - z.windup / 0.8;
      ctx.fillStyle = 'rgba(200,40,40,' + (0.12 + 0.15 * k) + ')';
      ctx.beginPath(); ctx.arc(z.x, z.y, 140, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,80,80,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, 140, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,60,60,0.25)';
      ctx.beginPath(); ctx.arc(z.x, z.y, 140 * k, 0, TAU); ctx.fill();
    }

    // caisses
    for (const c of R.crates) {
      if (!vis(c.x, c.y, 40)) continue;
      drawCrate(c);
    }
    // orbes
    for (const o of R.orbs) {
      if (!vis(o.x, o.y, 20)) continue;
      const pulse = 1 + Math.sin(o.t * 8) * 0.15;
      const fade = o.life < 4 ? (Math.sin(o.life * 12) > 0 ? 1 : 0.3) : 1;
      ctx.globalAlpha = fade;
      if (o.kind === 'soul') {
        const s = (3 + Math.min(5, o.v)) * pulse;
        ctx.fillStyle = 'rgba(120,200,255,0.25)'; ctx.beginPath(); ctx.arc(o.x, o.y, s * 2.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(o.x, o.y, s, 0, TAU); ctx.fill();
      } else if (o.kind === 'heal') {
        ctx.fillStyle = 'rgba(80,255,120,0.25)'; ctx.beginPath(); ctx.arc(o.x, o.y, 14 * pulse, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5dff8a';
        ctx.fillRect(o.x - 6, o.y - 2, 12, 4); ctx.fillRect(o.x - 2, o.y - 6, 4, 12);
      } else {
        ctx.fillStyle = 'rgba(255,210,90,0.25)'; ctx.beginPath(); ctx.arc(o.x, o.y, 13 * pulse, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c9a23a'; ctx.fillRect(o.x - 6, o.y - 4, 12, 8);
        ctx.fillStyle = '#ffe08a'; ctx.fillRect(o.x - 4, o.y - 2, 8, 2);
      }
    }
    ctx.globalAlpha = 1;

    // ombres des zombies
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    for (const z of R.zombies) {
      if (z.dead || !vis(z.x, z.y, z.r * 2)) continue;
      ctx.moveTo(z.x + 4 + z.r, z.y + 5);
      ctx.ellipse(z.x + 4, z.y + 5, z.r, z.r * 0.85, 0, 0, TAU);
    }
    ctx.fill();

    // zombies
    for (const z of R.zombies) {
      if (z.dead || !vis(z.x, z.y, z.r * 2.5)) continue;
      const set = Sprites.zombies[z.type][z.variant];
      const img = z.flash > 0 ? set.white : set.normal;
      ctx.save();
      ctx.translate(z.x, z.y);
      ctx.rotate(z.angle + Math.sin(z.wob) * 0.09);
      if (z.spawnFade < 1) ctx.globalAlpha = z.spawnFade;
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      if (z.inStasis) {
        const s = R.st.stasis.slow;
        ctx.fillStyle = s >= 1 ? 'rgba(150,220,255,0.45)' : 'rgba(120,180,255,' + (0.12 + s * 0.2) + ')';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 1.05, 0, TAU); ctx.fill();
        if (s >= 1) { ctx.strokeStyle = 'rgba(220,245,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      if (z.stun > 0) {
        ctx.fillStyle = '#ffe36a';
        for (let i = 0; i < 3; i++) {
          const a = R.t * 6 + i * TAU / 3;
          ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * z.r * 0.8, z.y + Math.sin(a) * z.r * 0.8 - 2, 2.2, 0, TAU); ctx.fill();
        }
      }
      if (z.d.boss || (z.hp < z.maxHp && (z.type === 'brute'))) {
        const w = z.r * 2.2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w, 5);
        ctx.fillStyle = z.d.boss ? '#c060ff' : '#e04040'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w * Math.max(0, z.hp / z.maxHp), 5);
      }
    }

    // grenades
    for (const g of R.grenades) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(g.x + 3, g.y + 4, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3e4a2c'; ctx.beginPath(); ctx.arc(g.x, g.y - g.h, g.mini ? 4 : 6, 0, TAU); ctx.fill();
      if (g.t >= g.dur && Math.sin(g.fuse * 40) > 0) { ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(g.x, g.y - g.h, 2, 0, TAU); ctx.fill(); }
    }

    // tourelles
    for (const t of R.turrets) drawTurret(t);

    // joueur
    drawPlayer(p);

    // balles
    for (const b of R.bullets) {
      if (b.kind === 'wave') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.globalAlpha = Math.min(1, b.life * 4);
        ctx.strokeStyle = 'rgba(170,235,255,0.9)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(-8, 0, b.r, -1.1, 1.1); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(-6, 0, b.r - 2, -0.9, 0.9); ctx.stroke();
        ctx.restore(); ctx.globalAlpha = 1;
      } else if (b.kind === 'shell') {
        ctx.fillStyle = '#4a5a32'; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,180,80,0.6)'; ctx.beginPath(); ctx.arc(b.x - b.vx * 0.012, b.y - b.vy * 0.012, 3, 0, TAU); ctx.fill();
      } else {
        ctx.strokeStyle = b.color || '#ffe9a0'; ctx.lineWidth = b.r * 0.9;
        ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    // projectiles ennemis
    for (const b of R.eproj) {
      ctx.fillStyle = b.friendly ? 'rgba(150,230,255,0.9)' : 'rgba(150,220,50,0.9)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = b.friendly ? '#fff' : '#e6ff8a';
      ctx.beginPath(); ctx.arc(b.x - 2, b.y - 2, b.r * 0.4, 0, TAU); ctx.fill();
    }

    // effets
    for (const f of R.fx) drawFx(f);

    // particules
    for (const q of R.particles) {
      if (!vis(q.x, q.y, 20)) continue;
      const k = q.life / q.max;
      if (q.kind === 'fire') {
        const c = k > 0.75 ? '255,214,110' : k > 0.4 ? '255,130,30' : '170,50,20';
        ctx.fillStyle = 'rgba(' + c + ',' + (k * 0.6) + ')';
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1.2 - k * 0.5), 0, TAU); ctx.fill();
      } else if (q.kind === 'goo') {
        ctx.fillStyle = 'rgba(150,200,40,' + k + ')';
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, TAU); ctx.fill();
      } else if (q.kind === 'smoke') {
        ctx.fillStyle = 'rgba(70,70,70,' + (k * 0.35) + ')';
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, TAU); ctx.fill();
      } else {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = q.color || '#fff';
        ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
        ctx.globalAlpha = 1;
      }
    }

    // feuillages au-dessus
    for (const o of R.obstacles) {
      if (!o.canopy || !vis(o.x, o.y, 60)) continue;
      const under = Math.hypot(p.x - o.x, p.y - o.y) < 50;
      ctx.globalAlpha = under ? 0.45 : 0.95;
      ctx.drawImage(o.canopy, o.x - o.canopy.width / 2, o.y - o.canopy.height / 2);
    }
    ctx.globalAlpha = 1;

    // textes de dégâts
    ctx.textAlign = 'center';
    for (const t of R.texts) {
      const k = t.t / t.dur;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = 'bold ' + Math.round(13 * t.scale * (k < 0.15 ? 1 + (0.15 - k) * 3 : 1)) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.txt, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // radar des caisses
    if (R.cls === 'soldier' && R.st.radar) {
      for (const c of R.crates) {
        if (vis(c.x, c.y, -100)) continue;
        const a = Math.atan2(c.y - p.y, c.x - p.x);
        const rx = Math.min(W / 2 / zoom - 40, H / 2 / zoom - 40) * 0.92;
        const ax = p.x + Math.cos(a) * rx, ay = p.y + Math.sin(a) * rx;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.fillStyle = 'rgba(255,210,90,0.85)';
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // éclairage : vignette nocturne
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    gr.addColorStop(0, 'rgba(5,8,15,0)');
    gr.addColorStop(1, 'rgba(5,8,15,0.72)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    if (p.hurtT > 0) {
      ctx.fillStyle = 'rgba(180,0,0,' + (p.hurtT * 0.9) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (p.hp < R.st.maxHp * 0.3 && !R.over) {
      const a = 0.18 + Math.sin(R.t * 6) * 0.08;
      const g2 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g2.addColorStop(0, 'rgba(150,0,0,0)'); g2.addColorStop(1, 'rgba(150,0,0,' + a + ')');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    }

    drawHud();
  }

  function drawCrate(c) {
    const drop = Math.max(0, 1 - c.t / 0.6);
    const s = c.big ? 1.25 : 1;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(4, 5, 18 * s * (1 - drop * 0.5), 16 * s * (1 - drop * 0.5), 0, 0, TAU); ctx.fill();
    ctx.translate(0, -drop * 120);
    if (drop > 0) { // parachute
      ctx.fillStyle = 'rgba(220,220,210,0.85)';
      ctx.beginPath(); ctx.arc(0, -30, 26, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(200,200,200,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-24, -30); ctx.lineTo(-10, -10); ctx.moveTo(24, -30); ctx.lineTo(10, -10); ctx.stroke();
    }
    const glow = 0.4 + Math.sin(c.t * 4) * 0.25;
    ctx.fillStyle = 'rgba(255,210,90,' + (glow * 0.35) + ')';
    ctx.beginPath(); ctx.arc(0, 0, 30 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = c.big ? '#5a6a3a' : '#7a5a32';
    ctx.fillRect(-16 * s, -14 * s, 32 * s, 28 * s);
    ctx.strokeStyle = '#2c1f10'; ctx.lineWidth = 2;
    ctx.strokeRect(-16 * s, -14 * s, 32 * s, 28 * s);
    ctx.beginPath(); ctx.moveTo(-16 * s, -14 * s); ctx.lineTo(16 * s, 14 * s); ctx.moveTo(16 * s, -14 * s); ctx.lineTo(-16 * s, 14 * s); ctx.stroke();
    ctx.fillStyle = '#e8d08a'; ctx.font = 'bold ' + (10 * s) + 'px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(c.big ? '★' : '✚', 0, 4 * s);
    ctx.restore();
  }

  function drawTurret(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(3, 4, 16, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a4048';
    ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.5; ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); } ctx.closePath(); ctx.fill();
    ctx.rotate(t.angle);
    ctx.fillStyle = '#5a6470'; ctx.fillRect(0, -3, 22, 6);
    ctx.fillStyle = '#7a8694'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
    if (t.muzzle > 0) { ctx.fillStyle = 'rgba(200,240,255,0.9)'; ctx.beginPath(); ctx.arc(25, 0, 5, 0, TAU); ctx.fill(); }
    ctx.restore();
    // jauge de durée
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(t.x - 16, t.y + 20, 32, 4);
    ctx.fillStyle = '#9fe8ff'; ctx.fillRect(t.x - 16, t.y + 20, 32 * t.t / t.max, 4);
  }

  function drawStasis(p) {
    const st = R.st.stasis;
    const k = Math.min(1, p.stasisT / 0.3, (p.stasisMax - p.stasisT + 0.3) / 0.3);
    const rad = st.radius;
    ctx.save();
    ctx.translate(p.x, p.y);
    const g = ctx.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad);
    g.addColorStop(0, 'rgba(90,150,255,0.03)');
    g.addColorStop(0.85, 'rgba(110,170,255,' + (0.1 + st.slow * 0.1) * k + ')');
    g.addColorStop(1, 'rgba(160,210,255,' + 0.35 * k + ')');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(170,215,255,' + 0.6 * k + ')'; ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.rotate(R.t * 0.4);
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // graduations d'horloge
    ctx.rotate(-R.t * 0.4);
    ctx.strokeStyle = 'rgba(190,225,255,' + 0.5 * k + ')'; ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (rad - 12), Math.sin(a) * (rad - 12)); ctx.lineTo(Math.cos(a) * (rad - 3), Math.sin(a) * (rad - 3)); ctx.stroke();
    }
    // aiguille (temps restant)
    const frac = p.stasisT / p.stasisMax;
    ctx.strokeStyle = 'rgba(220,240,255,' + 0.55 * k + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, rad - 20, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.stroke();
    ctx.restore();
  }

  function drawFx(f) {
    const k = f.t / f.dur;
    if (f.kind === 'push') {
      const r = f.range * (0.3 + 0.7 * k);
      const col = f.color || '170,220,255';
      ctx.save(); ctx.translate(f.x, f.y);
      ctx.strokeStyle = 'rgba(' + col + ',' + (1 - k) * 0.8 + ')';
      ctx.lineWidth = 10 * (1 - k) + 2;
      ctx.beginPath();
      if (f.arc >= TAU - 0.01) ctx.arc(0, 0, r, 0, TAU);
      else ctx.arc(0, 0, r, f.angle - f.arc / 2, f.angle + f.arc / 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(' + col + ',' + (1 - k) * 0.15 + ')';
      ctx.beginPath();
      if (f.arc >= TAU - 0.01) ctx.arc(0, 0, r, 0, TAU);
      else { ctx.moveTo(0, 0); ctx.arc(0, 0, r, f.angle - f.arc / 2, f.angle + f.arc / 2); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
    } else if (f.kind === 'boom') {
      const r = f.r * (0.4 + 0.6 * Math.sqrt(k));
      const col = f.color || '255,170,60';
      ctx.fillStyle = 'rgba(' + col + ',' + (1 - k) * 0.45 + ')';
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,200,' + (1 - k) * 0.8 + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke();
      if (k < 0.3) { ctx.fillStyle = 'rgba(255,255,230,' + (0.3 - k) * 2.5 + ')'; ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.5, 0, TAU); ctx.fill(); }
    }
  }

  function drawPlayer(p) {
    const st = R.st;
    ctx.save();
    ctx.translate(p.x, p.y);
    // ombre
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(4, 6, 17, 15, 0, 0, TAU); ctx.fill();
    if (p.invuln > 0 && !p.dash && Math.sin(R.t * 40) > 0) ctx.globalAlpha = 0.5;

    if (R.cls === 'samurai') {
      // Tempête de lames : déluge fluide de lames tourbillonnantes à échelle humaine
      if (p.ultT > 0) {
        const rad = st.ult.radius;
        const fade = Math.min(1, p.ultT / 0.2, (p.ultMax - p.ultT + 0.15) / 0.2);
        ctx.save();
        ctx.globalAlpha *= fade;
        // Anneau de souffle défensif au sol
        const ug = ctx.createRadialGradient(0, 0, rad * 0.3, 0, 0, rad);
        ug.addColorStop(0, 'rgba(120,210,255,0)');
        ug.addColorStop(0.75, 'rgba(130,215,255,0.08)');
        ug.addColorStop(1, 'rgba(180,238,255,0.28)');
        ctx.fillStyle = ug;
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill();

        // Déluge de croissants de lames fluides qui s'entrelacent autour du samouraï
        const slashes = 5;
        for (let i = 0; i < slashes; i++) {
          const speed = (i % 2 === 0 ? 22 : 27);
          const baseA = R.t * speed + i * (TAU / slashes);
          const rBlade = rad * (0.62 + 0.11 * ((i * 3) % 4));
          const span = 1.65;
          const segs = 7;
          for (let s = 0; s < segs; s++) {
            const t0 = s / segs, t1 = (s + 1) / segs;
            const a0 = baseA - span * (1 - t0), a1 = baseA - span * (1 - t1);
            ctx.strokeStyle = 'rgba(140,225,255,' + (0.06 + 0.48 * t1 * t1) + ')';
            ctx.lineWidth = 1.5 + 6.5 * Math.sin(t1 * Math.PI * 0.85);
            ctx.beginPath();
            ctx.arc(0, 0, rBlade * (0.92 + 0.08 * t1), a0, a1);
            ctx.stroke();
          }
          // Fil d'acier blanc lumineux sur le tranchant avant
          ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(0, 0, rBlade, baseA - span * 0.55, baseA + 0.08);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (p.dash) {
        ctx.fillStyle = 'rgba(150,220,255,0.3)';
        ctx.beginPath(); ctx.arc(-p.dash.vx * 0.02, -p.dash.vy * 0.02, 16, 0, TAU); ctx.fill();
      }
      // trace de coup de sabre
      if (p.swingT > 0) {
        const k = 1 - p.swingT / p.swingDur;
        const range = st.swordRange * (p.swingWhirl ? 1.12 : 1);
        const a0 = p.swingAngle - p.swingArc / 2 * p.swingDir;
        const sweep = p.swingArc * p.swingDir;
        const aCur = a0 + sweep * Math.min(1, k * 1.3);
        ctx.save();
        ctx.globalAlpha = 1 - k * 0.6;
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps, t1 = (i + 1) / steps;
          const aa = a0 + (aCur - a0) * t0, ab = a0 + (aCur - a0) * t1;
          ctx.strokeStyle = 'rgba(180,235,255,' + (0.1 + 0.5 * t1) + ')';
          ctx.lineWidth = 6 + 10 * t1;
          ctx.beginPath(); ctx.arc(0, 0, range * 0.72, aa, ab, sweep < 0); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, range * 0.92, a0, aCur, sweep < 0); ctx.stroke();
        ctx.restore();
      }
      ctx.rotate(p.ultT > 0 ? R.t * 24 : p.angle);
      // sabre
      let sa;
      if (p.ultT > 0) {
        sa = 0.12;
      } else if (p.swingT > 0) {
        const k = 1 - p.swingT / p.swingDur;
        sa = angDiff(p.swingAngle, p.angle) + (-p.swingArc / 2 + p.swingArc * Math.min(1, k * 1.3)) * p.swingDir;
      } else sa = 0.85;
      const swordLen = 30 + st.swordRange * 0.35;
      ctx.save();
      ctx.translate(4, 9);
      ctx.rotate(sa);
      if (p.ultT > 0) {
        ctx.fillStyle = 'rgba(170,235,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.arc(0, 0, swordLen, -0.75, 0.05);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(120,210,255,0.35)'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(swordLen, 0); ctx.stroke();
      ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(swordLen, 0); ctx.stroke();
      ctx.fillStyle = '#c9a23a'; ctx.fillRect(5, -4, 3, 8); // garde
      ctx.fillStyle = '#2a1a10'; ctx.fillRect(-4, -1.5, 9, 3); // poignée
      ctx.restore();
      // corps (kimono)
      const step = p.moving ? Math.sin(p.walkPhase) * 3 : 0;
      ctx.fillStyle = '#1f2c48';
      ctx.beginPath(); ctx.ellipse(-2, 0, 10, 15, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#0c1220'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#7a1f2a'; ctx.fillRect(-4, -14, 3, 28); // ceinture
      // bras
      ctx.fillStyle = '#2b3c60';
      ctx.beginPath(); ctx.ellipse(6 + step * 0.3, 9, 6, 4, 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4 - step * 0.3, -10, 6, 4, -0.3, 0, TAU); ctx.fill();
      // chapeau conique
      const hg = ctx.createRadialGradient(-2, -2, 1, 0, 0, 14);
      hg.addColorStop(0, '#e2c98a'); hg.addColorStop(1, '#9b7f45');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(1, 0, 13, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5c4a26'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(92,74,38,0.5)'; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1 + Math.cos(a) * 12, Math.sin(a) * 12); ctx.stroke(); }
      ctx.fillStyle = '#5c4a26'; ctx.beginPath(); ctx.arc(1, 0, 2, 0, TAU); ctx.fill();
    } else {
      if (p.adrenT > 0) {
        ctx.strokeStyle = 'rgba(255,90,60,' + (0.4 + Math.sin(R.t * 20) * 0.2) + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
      }
      ctx.rotate(p.angle);
      const rec = -p.recoil * 3;
      // arme
      const wlen = { pistol: 14, shotgun: 26, rifle: 30, flamer: 28, launcher: 26, minigun: 32 }[p.weapon];
      const wcol = { pistol: '#2a2a2a', shotgun: '#5a3a22', rifle: '#2f3a2a', flamer: '#8a2a1a', launcher: '#3e4a2c', minigun: '#444a52' }[p.weapon];
      ctx.fillStyle = wcol;
      const wth = p.weapon === 'minigun' || p.weapon === 'launcher' || p.weapon === 'flamer' ? 7 : 4.5;
      ctx.fillRect(6 + rec, 6 - wth / 2 + 0, wlen, wth);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(6 + rec, 6 - wth / 2, wlen, wth);
      if (p.weapon === 'flamer') { ctx.fillStyle = '#c9a23a'; ctx.fillRect(-12, -6, 7, 12); }
      if (p.muzzle > 0) {
        ctx.fillStyle = 'rgba(255,230,140,0.95)';
        ctx.beginPath(); ctx.moveTo(6 + wlen + rec, 2); ctx.lineTo(6 + wlen + 16 + rec, 6); ctx.lineTo(6 + wlen + rec, 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,100,0.35)'; ctx.beginPath(); ctx.arc(6 + wlen + 6, 6, 14, 0, TAU); ctx.fill();
      }
      // corps
      ctx.fillStyle = '#4a5a34';
      ctx.beginPath(); ctx.ellipse(-2, 0, 10, 15, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1e2614'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#5d6e40'; ctx.fillRect(-7, -9, 9, 18); // gilet
      ctx.fillStyle = '#3a4628'; ctx.fillRect(-6, -7, 3, 4); ctx.fillRect(-6, 3, 3, 4);
      // bras vers l'arme
      ctx.fillStyle = '#c99a72';
      ctx.beginPath(); ctx.arc(8 + rec, 6, 3.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(14 + rec, 7, 3.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#4a5a34'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(8 + rec, 6); ctx.moveTo(0, -11); ctx.lineTo(14 + rec, 7); ctx.stroke();
      // casque
      const hg = ctx.createRadialGradient(-2, -3, 1, 0, 0, 11);
      hg.addColorStop(0, '#6f8250'); hg.addColorStop(1, '#3c4a2a');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(1, 0, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#222b16'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(30,40,20,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(7, -2); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------------- Interface en jeu ---------------- */
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  function bar(x, y, w, h, frac, col, bg, label, flash) {
    rr(x, y, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
    if (frac > 0) { rr(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2); ctx.fillStyle = col; ctx.fill(); }
    rr(x, y, w, h, h / 2); ctx.strokeStyle = flash ? '#ff5050' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = flash ? 2.5 : 1.2; ctx.stroke();
    if (label) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(h * 0.72) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w / 2, y + h / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  function drawHud() {
    const p = R.p, st = R.st;
    const small = W < 700;
    const s = small ? 0.85 : 1;
    ctx.save();
    // vie
    const bw = Math.min(260, W * 0.38) * s;
    const x0 = 14, y0 = 14;
    bar(x0, y0, bw, 18 * s, p.hp / st.maxHp, p.hp < st.maxHp * 0.3 ? '#ff3d3d' : '#d93b3b', 'rgba(0,0,0,0.55)', Math.ceil(p.hp) + ' / ' + Math.round(st.maxHp));
    let y = y0 + 24 * s;
    if (R.cls === 'samurai') {
      bar(x0, y, bw * 0.85, 13 * s, p.energy / st.energyMax, '#3aa0ff', 'rgba(0,0,0,0.55)', 'Ki ' + Math.floor(p.energy), p.energyFlash > 0);
      y += 19 * s;
    } else if (st.grenades) {
      ctx.font = 'bold ' + Math.round(14 * s) + 'px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#e8e0c8';
      ctx.fillText('🧨 ' + p.grenades + ' / ' + st.grenades.max, x0, y + 12 * s);
      y += 19 * s;
    }

    // vague
    ctx.textAlign = 'center';
    ctx.font = '900 ' + Math.round(22 * s) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('VAGUE ' + Math.max(1, R.wave), W / 2 + 1, 33 * s + 1);
    ctx.fillStyle = '#f2e6d0'; ctx.fillText('VAGUE ' + Math.max(1, R.wave), W / 2, 33 * s);
    ctx.font = '600 ' + Math.round(13 * s) + 'px system-ui, sans-serif';
    let sub;
    if (R.phase === 'break') sub = 'Prochaine vague dans ' + Math.ceil(R.breakT) + ' s';
    else sub = '🧟 ' + Math.max(0, R.waveTotal - R.killedWave) + ' restants';
    ctx.fillStyle = '#c9bfa8'; ctx.fillText(sub, W / 2, 52 * s);
    if (R.phase === 'fight') {
      const frac = R.killedWave / Math.max(1, R.waveTotal);
      bar(W / 2 - 80 * s, 58 * s, 160 * s, 5 * s, frac, '#a83232', 'rgba(0,0,0,0.5)');
    }

    // âmes et tués
    ctx.textAlign = 'right';
    ctx.font = 'bold ' + Math.round(17 * s) + 'px system-ui, sans-serif';
    ctx.fillStyle = '#bfe6ff';
    ctx.fillText('👻 ' + Math.floor(hooks.getSouls ? hooks.getSouls() : R.souls), W - (W >= 560 ? 60 : 14), 30 * s);
    if (W >= 560) {
      ctx.font = '600 ' + Math.round(13 * s) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#c9bfa8';
      ctx.fillText('+' + Math.floor(R.souls) + ' cette partie · ' + R.kills + ' tués', W - 60, 48 * s);
    }

    // mini-carte
    const ms = small ? 92 : 128;
    const mx = W - ms - 14, my = 60 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(mx, my, ms, ms);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, ms, ms);
    const k = ms / ARENA;
    if (R.floors) {
      ctx.fillStyle = 'rgba(65,55,45,0.35)';
      for (const fl of R.floors) ctx.fillRect(mx + (fl.x - fl.w / 2) * k, my + (fl.y - fl.h / 2) * k, fl.w * k, fl.h * k);
    }
    ctx.fillStyle = 'rgba(150,140,128,0.75)';
    for (const o of R.obstacles) {
      if (o.kind === 'rect') {
        const ow = Math.max(2, o.hw * 2 * k), oh = Math.max(2, o.hh * 2 * k);
        ctx.fillRect(mx + o.x * k - ow / 2, my + o.y * k - oh / 2, ow, oh);
      } else {
        ctx.fillRect(mx + o.x * k - 1.5, my + o.y * k - 1.5, 3, 3);
      }
    }
    ctx.fillStyle = '#d04040';
    for (let i = 0; i < R.zombies.length; i++) {
      const z = R.zombies[i];
      const sz = z.d.boss ? 5 : 2;
      ctx.fillRect(mx + z.x * k - sz / 2, my + z.y * k - sz / 2, sz, sz);
    }
    ctx.fillStyle = '#ffd86a';
    for (const c of R.crates) ctx.fillRect(mx + c.x * k - 2.5, my + c.y * k - 2.5, 5, 5);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(mx + p.x * k, my + p.y * k, 3, 0, TAU); ctx.fill();
    const vw = W / zoom * k, vh = H / zoom * k;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(mx + R.cam.x * k - vw / 2, my + R.cam.y * k - vh / 2, vw, vh);

    // capacités / armes (en bas)
    if (!touchMode) drawSlots(s);
    else drawSlotsCompact(s);

    // bannière
    if (R.banner) {
      const b = R.banner;
      const a = Math.min(1, b.t * 4, (b.dur - b.t) * 2);
      ctx.globalAlpha = Math.max(0, a);
      ctx.textAlign = 'center';
      ctx.font = '900 ' + Math.round(Math.min(54, W / 12)) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(b.text, W / 2 + 2, H * 0.3 + 2);
      ctx.fillStyle = '#f5e2c0'; ctx.fillText(b.text, W / 2, H * 0.3);
      if (b.sub) {
        ctx.font = '600 ' + Math.round(Math.min(22, W / 26)) + 'px system-ui, sans-serif';
        ctx.fillStyle = '#e0c9a0'; ctx.fillText(b.sub, W / 2, H * 0.3 + 34);
      }
      ctx.globalAlpha = 1;
    }

    // aide des commandes en début de partie
    {
      if (R.hintT > 0 && !touchMode) {
        ctx.globalAlpha = Math.min(1, R.hintT);
        const lines = R.cls === 'samurai'
          ? ['ZQSD / WASD : se déplacer', 'Souris : viser · Clic gauche : sabre (coûte du Ki)', 'Clic droit ou E : Poussée' + (st.dash ? ' · Espace : Pas du vent' : ''),
            (st.stasis ? 'F : Stase temporelle' : '') + (st.ult ? ' · R : Tempête de lames' : ''), 'Échap : pause']
          : ['ZQSD / WASD : se déplacer', 'Souris : viser · Clic gauche : tirer', '1-6 ou molette : changer d\'arme', 'Marchez sur les caisses pour les munitions',
            (st.grenades ? 'Clic droit / E : grenade' : '') + (st.roll ? ' · Espace : roulade' : '') + (st.adren ? ' · F : adrénaline' : '') + (st.turret ? ' · R : tourelle' : ''), 'Échap : pause'];
        ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center';
        const lh = 20, bh = lines.filter(Boolean).length * lh + 16;
        const by = H * 0.62;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(W / 2 - 220, by, 440, bh, 10); ctx.fill();
        ctx.fillStyle = '#e8dcc4';
        lines.filter(Boolean).forEach((l, i) => ctx.fillText(l, W / 2, by + 24 + i * lh));
        ctx.globalAlpha = 1;
      }
    }

    // joysticks tactiles
    if (touchMode) {
      for (const k2 of ['move', 'aim']) {
        const sk = sticks[k2];
        if (!sk) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sk.ox, sk.oy, 60, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(sk.x, sk.y, 26, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  function slotList() {
    const p = R.p, st = R.st;
    const list = [];
    if (R.cls === 'samurai') {
      list.push({ key: 'Clic', icon: '🗡️', name: 'Sabre', cost: st.swordCost, frac: Math.max(0, p.atkT) / st.swordCd, ready: p.energy >= st.swordCost && p.atkT <= 0 });
      list.push({ key: 'E', icon: '✋', name: 'Poussée', cost: st.push.cost, ready: p.energy >= st.push.cost && !p.pushCd, frac: (p.pushCd || 0) / st.push.cd, action: 'secondary' });
      if (st.dash) list.push({ key: 'Esp.', icon: '🍃', name: 'Pas du vent', cost: st.dash.cost, ready: p.energy >= st.dash.cost, action: 'mobility' });
      if (st.stasis) list.push({ key: 'F', icon: '⏳', name: 'Stase', cost: st.stasis.cost, ready: p.energy >= st.stasis.cost && !p.stasisCd, frac: (p.stasisCd || 0) / st.stasis.cd, active: p.stasisT > 0 ? p.stasisT / p.stasisMax : 0, action: 'special' });
      if (st.ult) list.push({ key: 'R', icon: '⚔️', name: 'Tempête', cost: st.ult.cost, ready: p.energy >= st.ult.cost && !p.ultCd, frac: (p.ultCd || 0) / (st.ult.cd || 8), active: p.ultT > 0 ? p.ultT / st.ult.dur : 0, action: 'ultimate' });
    } else {
      if (st.grenades) list.push({ key: 'E', icon: '🧨', name: 'Grenade', count: p.grenades, ready: p.grenades > 0, frac: p.nadeCd / 0.35, action: 'secondary' });
      if (st.roll) list.push({ key: 'Esp.', icon: '🤸', name: 'Roulade', frac: p.rollCd / st.roll.cd, ready: p.rollCd <= 0, action: 'mobility' });
      if (st.adren) list.push({ key: 'F', icon: '💉', name: 'Adrénaline', frac: p.adrenCd / st.adren.cd, ready: p.adrenCd <= 0, active: p.adrenT > 0 ? p.adrenT / st.adren.dur : 0, action: 'special' });
      if (st.turret) list.push({ key: 'R', icon: '🗼', name: 'Tourelle', frac: p.turretCd / st.turret.cd, ready: p.turretCd <= 0, action: 'ultimate' });
    }
    return list;
  }

  function drawSlot(x, y, sz, sl) {
    rr(x, y, sz, sz, 10);
    ctx.fillStyle = sl.active ? 'rgba(60,120,200,0.55)' : 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.strokeStyle = sl.ready ? 'rgba(255,255,255,0.45)' : 'rgba(255,80,80,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.globalAlpha = sl.ready ? 1 : 0.45;
    ctx.font = Math.round(sz * 0.45) + 'px system-ui, "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(sl.icon, x + sz / 2, y + sz / 2 - 2);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
    if (sl.frac > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.moveTo(x + sz / 2, y + sz / 2);
      ctx.arc(x + sz / 2, y + sz / 2, sz * 0.7, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, sl.frac));
      ctx.closePath();
      ctx.save(); rr(x, y, sz, sz, 10); ctx.clip(); ctx.fill(); ctx.restore();
    }
    if (sl.active) {
      ctx.fillStyle = '#7cc8ff'; ctx.fillRect(x + 4, y + sz - 5, (sz - 8) * sl.active, 3);
    }
    ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#ffe9b0'; ctx.textAlign = 'left';
    ctx.fillText(sl.key, x + 4, y + 12);
    if (sl.cost !== undefined) { ctx.textAlign = 'right'; ctx.fillStyle = '#9fd0ff'; ctx.fillText(Math.round(sl.cost), x + sz - 4, y + sz - 6); }
    if (sl.count !== undefined) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 12px system-ui'; ctx.fillText(sl.count, x + sz - 4, y + sz - 5); }
  }

  function drawWeapons(cx, y, s) {
    const p = R.p, st = R.st;
    const list = availableWeapons();
    const ww = 74 * s, wh = 40 * s, gap = 6;
    const total = list.length * ww + (list.length - 1) * gap;
    let x = cx - total / 2;
    for (const k of list) {
      const i = WEAPON_ORDER.indexOf(k);
      const sel = p.weapon === k;
      const ammo = p.ammo[k];
      rr(x, y, ww, wh, 8);
      ctx.fillStyle = sel ? 'rgba(200,140,40,0.55)' : 'rgba(0,0,0,0.55)'; ctx.fill();
      ctx.strokeStyle = sel ? '#ffcf70' : 'rgba(255,255,255,0.25)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
      ctx.globalAlpha = ammo > 0 ? 1 : 0.4;
      ctx.textAlign = 'left'; ctx.font = 'bold ' + Math.round(10 * s) + 'px system-ui'; ctx.fillStyle = '#ffe9b0';
      ctx.fillText(i + 1, x + 5, y + 12 * s);
      ctx.textAlign = 'center'; ctx.font = '600 ' + Math.round(11 * s) + 'px system-ui'; ctx.fillStyle = '#fff';
      ctx.fillText(WEAPON_NAMES[k], x + ww / 2 + 4, y + 15 * s);
      ctx.font = 'bold ' + Math.round(14 * s) + 'px system-ui'; ctx.fillStyle = ammo > 0 ? '#ffd86a' : '#ff6a6a';
      ctx.fillText(ammo === Infinity ? '∞' : ammo, x + ww / 2, y + 33 * s);
      if (ammo !== Infinity) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 6, y + wh - 4, ww - 12, 2);
        ctx.fillStyle = '#ffd86a'; ctx.fillRect(x + 6, y + wh - 4, (ww - 12) * ammo / st.weapons[k].cap, 2);
      }
      ctx.globalAlpha = 1;
      x += ww + gap;
    }
  }

  function drawSlots(s) {
    const list = slotList();
    const sz = 54 * s, gap = 8;
    const y = H - sz - 14;
    if (R.cls === 'soldier') {
      drawWeapons(W / 2, H - 40 * s - 14 - (list.length ? sz + 10 : 0), s);
    }
    const total = list.length * sz + (list.length - 1) * gap;
    let x = W / 2 - total / 2;
    for (const sl of list) { drawSlot(x, y, sz, sl); x += sz + gap; }
  }

  function drawSlotsCompact(s) {
    // en tactile, les boutons DOM servent de commandes ; on n'affiche que les armes
    if (R.cls === 'soldier') drawWeapons(W / 2, H - 40 * s - 12, s * 0.9);
  }

  /* ---------------- Boucle ---------------- */
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!R) { lastFrame = ts; return; }
    let dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0);
    lastFrame = ts;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= 1 / 60 && n < 6) { step(1 / 60); acc -= 1 / 60; n++; }
      if (n >= 6) acc = 0;
    }
    render();
  }

  function togglePause(force) {
    if (!R || R.over) return;
    paused = force !== undefined ? force : !paused;
    mouse.left = false;
    for (const k in held) held[k] = false;
    hooks.onPause && hooks.onPause(paused);
  }

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    Sprites.build();
    bindInput();
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  }

  return {
    init, newRun, step, render, resize, togglePause, quitRun, virtualPress, virtualHold, setTouchMode,
    get R() { return R; }, get paused() { return paused; }, get touchMode() { return touchMode; },
    set settings(v) { settings = Object.assign(settings, v); }, get settings() { return settings; },
    set hooks(v) { hooks = Object.assign(hooks, v); },
    startWave, cycleWeapon, spawnZombie, spawnCrate, ARENA,
  };
})();
