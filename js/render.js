'use strict';
/* HORDE — rendu : labyrinthe, horde, joueurs, interface en jeu. */

let groundPattern = null;
let wallSprites = null;
let mapCv = null, mapVersion = -1;

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  VW = Math.max(320, window.innerWidth || 800);
  VH = Math.max(240, window.innerHeight || 600);
  canvas.width = Math.round(VW * dpr);
  canvas.height = Math.round(VH * dpr);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  zoom = clamp(Math.sqrt(VW * VH) / 800, 0.6, 1.2);
}

/* Murs : 16 variantes selon les côtés ouverts (bit 1 = nord, 2 = est, 4 = sud, 8 = ouest), 2 textures. */
function buildWalls() {
  wallSprites = [];
  let seed = 4242;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let v = 0; v < 2; v++) for (let mask = 0; mask < 16; mask++) {
    const c = document.createElement('canvas'); c.width = c.height = TILE;
    const g = c.getContext('2d');
    g.fillStyle = v ? '#3b3a3d' : '#403b36';
    g.fillRect(0, 0, TILE, TILE);
    // blocs de pierre
    g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 1.5;
    for (let row = 0; row < 3; row++) {
      const y = row * 16;
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(TILE, y + 0.5); g.stroke();
      const off = (row + v) % 2 ? 12 : 0;
      for (let x = off; x < TILE; x += 24) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 16); g.stroke(); }
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.14)';
      g.fillRect(rnd() * TILE, rnd() * TILE, 2 + rnd() * 5, 2 + rnd() * 4);
    }
    if (rnd() < 0.35) { // mousse
      g.fillStyle = 'rgba(70,95,50,0.35)';
      g.beginPath(); g.ellipse(rnd() * TILE, rnd() * TILE, 6 + rnd() * 8, 4 + rnd() * 5, rnd() * 3, 0, TAU); g.fill();
    }
    // arêtes : claires au nord / ouest, sombres au sud / est
    if (mask & 1) { g.fillStyle = 'rgba(190,180,160,0.5)'; g.fillRect(0, 0, TILE, 3); }
    if (mask & 8) { g.fillStyle = 'rgba(170,160,140,0.35)'; g.fillRect(0, 0, 3, TILE); }
    if (mask & 4) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, TILE - 5, TILE, 5); }
    if (mask & 2) { g.fillStyle = 'rgba(0,0,0,0.42)'; g.fillRect(TILE - 4, 0, 4, TILE); }
    wallSprites.push(c);
  }
}

function buildMapCanvas() {
  if (!mapCv) { mapCv = document.createElement('canvas'); mapCv.width = mapCv.height = GW * 2; }
  const g = mapCv.getContext('2d');
  g.fillStyle = '#14120f'; g.fillRect(0, 0, GW * 2, GW * 2);
  for (let ty = 0; ty < GW; ty++) for (let tx = 0; tx < GW; tx++) {
    const t = ty * GW + tx;
    if (World.solid[t]) { g.fillStyle = '#6f685c'; g.fillRect(tx * 2, ty * 2, 2, 2); }
    else if (World.roomT[t]) { g.fillStyle = '#2a251d'; g.fillRect(tx * 2, ty * 2, 2, 2); }
  }
  mapVersion = World.version;
}

function render() {
  if (!R) return;
  const p = me();
  // En visée automatique, la cible change sans cesse : la caméra ne suit pas l'orientation (sinon l'écran tremble).
  const lead = settings.autoAim || (touchMode && !sticks.aim) ? 0 : 40;
  const tx = p.x + Math.cos(p.angle) * lead, ty = p.y + Math.sin(p.angle) * lead;
  R.cam.x += (tx - R.cam.x) * 0.12;
  R.cam.y += (ty - R.cam.y) * 0.12;
  const sk = R.cam.shake;
  const cx = R.cam.x + (sk ? rand(-sk, sk) : 0), cy = R.cam.y + (sk ? rand(-sk, sk) : 0);
  const S = dpr * zoom, OX = dpr * VW / 2 - S * cx, OY = dpr * VH / 2 - S * cy;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#08090a';
  ctx.fillRect(0, 0, VW, VH);
  ctx.setTransform(S, 0, 0, S, OX, OY);
  const vx0 = cx - VW / 2 / zoom - 80, vx1 = cx + VW / 2 / zoom + 80, vy0 = cy - VH / 2 / zoom - 80, vy1 = cy + VH / 2 / zoom + 80;
  const vis = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
  const tx0 = clamp((vx0 / TILE) | 0, 0, GW - 1), tx1 = clamp((vx1 / TILE) | 0, 0, GW - 1);
  const ty0 = clamp((vy0 / TILE) | 0, 0, GW - 1), ty1 = clamp((vy1 / TILE) | 0, 0, GW - 1);
  const solid = World.solid, roomT = World.roomT;

  // sol
  if (!groundPattern) groundPattern = ctx.createPattern(Sprites.groundTile, 'repeat');
  ctx.fillStyle = groundPattern;
  ctx.fillRect(Math.max(0, vx0), Math.max(0, vy0), Math.min(WORLD, vx1) - Math.max(0, vx0), Math.min(WORLD, vy1) - Math.max(0, vy0));
  // dalles des places + ombres portées des murs
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const t = y * GW + x;
    if (solid[t]) continue;
    if (roomT[t]) {
      ctx.fillStyle = (x + y) & 1 ? 'rgba(120,100,70,0.10)' : 'rgba(120,100,70,0.16)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
    if (y > 0 && solid[t - GW]) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(x * TILE, y * TILE, TILE, 13); }
    if (x > 0 && solid[t - 1]) { ctx.fillStyle = 'rgba(0,0,0,0.24)'; ctx.fillRect(x * TILE, y * TILE, 9, TILE); }
  }

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

  // stases, Gonflés sur le point d'exploser, coups de Colosse
  for (const q of R.players) if (q.cls === 'samurai' && q.stasisT > 0 && !q.gone) drawStasis(q);
  for (const b of R.bombs) {
    const k = 1 - b.t / b.max;
    ctx.fillStyle = 'rgba(160,200,40,' + (0.1 + 0.2 * k) + ')';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(200,240,80,' + (0.4 + 0.4 * Math.sin(k * 30)) + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#b6c25e';
    ctx.beginPath(); ctx.arc(b.x, b.y, 16 + 10 * k + Math.sin(k * 40) * 2, 0, TAU); ctx.fill();
  }
  for (const f of R.fx) {
    if (f.kind !== 'warn') continue;
    const k = f.t / f.dur;
    ctx.fillStyle = 'rgba(200,40,40,' + (0.12 + 0.15 * k) + ')';
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,80,80,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,60,60,0.25)';
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, TAU); ctx.fill();
  }

  // relique
  if (R.relic && vis(R.relic.x, R.relic.y, 80)) drawRelic(R.relic);
  for (const c of R.crates) if (vis(c.x, c.y, 40)) drawCrate(c);
  // orbes
  for (const o of R.orbs) {
    if (!vis(o.x, o.y, 20)) continue;
    const pulse = 1 + Math.sin(o.t * 8) * 0.15;
    ctx.globalAlpha = o.life < 4 ? (Math.sin(o.life * 12) > 0 ? 1 : 0.3) : 1;
    if (o.kind === 'soul') {
      const s = (3 + Math.min(4, o.v * 1.5)) * pulse;
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
  const zs = R.zombies;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead || !vis(z.x, z.y, z.r * 2)) continue;
    ctx.moveTo(z.x + 4 + z.r, z.y + 5);
    ctx.ellipse(z.x + 4, z.y + 5, z.r, z.r * 0.85, 0, 0, TAU);
  }
  ctx.fill();

  // zombies
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead || !vis(z.x, z.y, z.r * 2.5)) continue;
    const set = Sprites.zombies[z.type][z.variant];
    const img = z.flash > 0 ? set.white : set.normal;
    const a = z.angle + Math.sin(z.wob) * 0.09, co = Math.cos(a) * S, si = Math.sin(a) * S;
    ctx.setTransform(co, si, -si, co, OX + S * z.x, OY + S * z.y);
    if (z.spawnFade < 1) ctx.globalAlpha = z.spawnFade;
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    if (z.spawnFade < 1) ctx.globalAlpha = 1;
  }
  ctx.setTransform(S, 0, 0, S, OX, OY);
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead || !(z.inStasis || z.stun > 0 || z.d.boss || z.type === 'brute') || !vis(z.x, z.y, z.r * 2.5)) continue;
    if (z.inStasis) {
      ctx.fillStyle = 'rgba(130,195,255,0.3)';
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 1.05, 0, TAU); ctx.fill();
    }
    if (z.stun > 0) {
      ctx.fillStyle = '#ffe36a';
      for (let k = 0; k < 3; k++) {
        const a = R.t * 6 + k * TAU / 3;
        ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * z.r * 0.8, z.y + Math.sin(a) * z.r * 0.8 - 2, 2.2, 0, TAU); ctx.fill();
      }
    }
    if (z.d.boss || (z.hp < z.maxHp && z.type === 'brute')) {
      const w = z.r * 2.2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w, 5);
      ctx.fillStyle = z.d.boss ? '#c060ff' : '#e04040'; ctx.fillRect(z.x - w / 2, z.y - z.r - 14, w * clamp(z.hp / z.maxHp, 0, 1), 5);
    }
  }

  // grenades
  for (const g of R.grenades) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(g.x + 3, g.y + 4, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3e4a2c'; ctx.beginPath(); ctx.arc(g.x, g.y - g.h, g.mini ? 4 : 6, 0, TAU); ctx.fill();
    if (g.t >= g.dur && Math.sin(g.fuse * 40) > 0) { ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(g.x, g.y - g.h, 2, 0, TAU); ctx.fill(); }
  }
  for (const t of R.turrets) drawTurret(t);

  // joueurs (ceux à terre d'abord)
  for (const q of R.players) if (!q.gone && q.down) drawDowned(q);
  for (const q of R.players) if (!q.gone && !q.down && !q.local) drawPlayer(q);
  if (!p.down) drawPlayer(p);

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
  for (const b of R.eproj) {
    ctx.fillStyle = b.friendly ? 'rgba(150,230,255,0.9)' : 'rgba(150,220,50,0.9)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.fillStyle = b.friendly ? '#fff' : '#e6ff8a';
    ctx.beginPath(); ctx.arc(b.x - 2, b.y - 2, b.r * 0.4, 0, TAU); ctx.fill();
  }

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

  // murs
  if (!wallSprites) buildWalls();
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const t = y * GW + x;
    if (!solid[t]) continue;
    const mask = (y > 0 && !solid[t - GW] ? 1 : 0) | (x < GW - 1 && !solid[t + 1] ? 2 : 0) | (y < GW - 1 && !solid[t + GW] ? 4 : 0) | (x > 0 && !solid[t - 1] ? 8 : 0);
    ctx.drawImage(wallSprites[((x * 7 + y * 13) & 1) * 16 + mask], x * TILE, y * TILE);
  }
  // murs sur le point de bouger
  if (R.shift) {
    const k = 0.35 + 0.3 * Math.sin(R.t * 14);
    for (const [list, col] of [[R.shift.close, '255,70,50'], [R.shift.open, '90,220,255']]) {
      ctx.fillStyle = 'rgba(' + col + ',' + k + ')';
      ctx.strokeStyle = 'rgba(' + col + ',0.9)'; ctx.lineWidth = 2;
      for (const id of list) for (const t of World.linkTiles(id)) {
        const x = (t % GW) * TILE, y = (t / GW | 0) * TILE;
        if (!vis(x, y, TILE)) continue;
        ctx.fillRect(x, y, TILE, TILE); ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      }
    }
  }

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

  // flèches : caisses (radar), relique, coéquipier
  const arrow = (x, y, col, big) => {
    if (vis(x, y, -100)) return;
    const a = Math.atan2(y - p.y, x - p.x);
    const rx = Math.min(VW / 2 / zoom - 40, VH / 2 / zoom - 40) * 0.92;
    ctx.save(); ctx.translate(p.x + Math.cos(a) * rx, p.y + Math.sin(a) * rx); ctx.rotate(a);
    if (big) ctx.scale(1.5, 1.5);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  if (p.cls === 'soldier' && p.st.radar) for (const c of R.crates) arrow(c.x, c.y, 'rgba(255,210,90,0.85)');
  if (R.relic) arrow(R.relic.x, R.relic.y, 'rgba(200,120,255,' + (0.7 + 0.3 * Math.sin(R.t * 6)) + ')', true);
  for (const q of R.players) if (!q.local && !q.gone) arrow(q.x, q.y, q.down ? 'rgba(255,70,70,0.95)' : 'rgba(120,255,160,0.85)', q.down);

  // obscurité : on ne voit bien qu'autour de soi
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const px = VW / 2 + (p.x - cx) * zoom, py = VH / 2 + (p.y - cy) * zoom;
  const lr = Math.max(VW, VH) * 0.62;
  const gr = ctx.createRadialGradient(px, py, lr * 0.3, px, py, lr);
  gr.addColorStop(0, 'rgba(4,6,12,0)');
  gr.addColorStop(0.6, 'rgba(4,6,12,0.5)');
  gr.addColorStop(1, 'rgba(4,6,12,0.9)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, VW, VH);
  if (R.furyT > 0) {
    ctx.fillStyle = 'rgba(255,60,20,' + (0.06 + 0.04 * Math.sin(R.t * 10)) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }
  if (R.levelFlash > 0) { ctx.fillStyle = 'rgba(255,220,120,' + R.levelFlash * 0.22 + ')'; ctx.fillRect(0, 0, VW, VH); }
  if (p.hurtT > 0) {
    ctx.fillStyle = 'rgba(180,0,0,' + (p.hurtT * 0.9) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }
  if ((p.hp < p.maxHp * 0.3 || p.down) && !R.over) {
    const a = 0.18 + Math.sin(R.t * 6) * 0.08;
    const g2 = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.hypot(VW, VH) * 0.55);
    g2.addColorStop(0, 'rgba(150,0,0,0)'); g2.addColorStop(1, 'rgba(150,0,0,' + a + ')');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, VW, VH);
  }

  drawHud();
}

function drawRelic(r) {
  const col = r.kind === 'fury' ? '255,90,50' : r.kind === 'nova' ? '255,225,120' : '140,215,255';
  const icon = r.kind === 'fury' ? '🔥' : r.kind === 'nova' ? '☀️' : '❄️';
  const bob = Math.sin(r.t * 3) * 4;
  ctx.save();
  ctx.translate(r.x, r.y);
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
  g.addColorStop(0, 'rgba(' + col + ',0.5)'); g.addColorStop(1, 'rgba(' + col + ',0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(' + col + ',0.8)'; ctx.lineWidth = 2;
  ctx.rotate(r.t * 1.2);
  ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  ctx.rotate(-r.t * 1.2);
  ctx.fillStyle = 'rgba(20,16,26,0.9)';
  ctx.beginPath(); ctx.moveTo(0, -18 + bob); ctx.lineTo(13, bob); ctx.lineTo(0, 18 + bob); ctx.lineTo(-13, bob); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '16px system-ui, "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(icon, 0, bob + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawCrate(c) {
  const drop = Math.max(0, 1 - c.t / 0.6);
  const s = c.big ? 1.25 : 1;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(4, 5, 18 * s * (1 - drop * 0.5), 16 * s * (1 - drop * 0.5), 0, 0, TAU); ctx.fill();
  ctx.translate(0, -drop * 120);
  if (drop > 0) {
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
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(t.x - 16, t.y + 20, 32, 4);
  ctx.fillStyle = '#9fe8ff'; ctx.fillRect(t.x - 16, t.y + 20, 32 * clamp(t.t / t.max, 0, 1), 4);
}

function drawStasis(p) {
  const st = p.st.stasis;
  const k = clamp(Math.min(p.stasisT / 0.3, (p.stasisMax - p.stasisT + 0.3) / 0.3), 0, 1);
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
  ctx.rotate(-R.t * 0.4);
  ctx.strokeStyle = 'rgba(190,225,255,' + 0.5 * k + ')'; ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * (rad - 12), Math.sin(a) * (rad - 12)); ctx.lineTo(Math.cos(a) * (rad - 3), Math.sin(a) * (rad - 3)); ctx.stroke();
  }
  const frac = clamp(p.stasisT / p.stasisMax, 0, 1);
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

function drawDowned(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(90,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, 0, 26, 20, 0, 0, TAU); ctx.fill();
  ctx.rotate(1.2);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = p.cls === 'samurai' ? '#1f2c48' : '#4a5a34';
  ctx.beginPath(); ctx.ellipse(0, 0, 17, 9, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = p.cls === 'samurai' ? '#9b7f45' : '#3c4a2a';
  ctx.beginPath(); ctx.arc(14, 0, 8, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.rotate(-1.2);
  // jauge de réanimation
  ctx.strokeStyle = 'rgba(255,80,80,' + (0.5 + 0.4 * Math.sin(R.t * 6)) + ')'; ctx.lineWidth = 3;
  ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(0, 0, 80, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  if (p.reviveT > 0) {
    ctx.strokeStyle = '#7dff8a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 34, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.reviveT / 3, 0, 1)); ctx.stroke();
  }
  ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff9a9a';
  ctx.fillText(p.reviveT > 0 ? 'RÉANIMATION…' : 'À TERRE', 0, -44);
  ctx.restore();
}

function drawPlayer(p) {
  const st = p.st;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(4, 6, 17, 15, 0, 0, TAU); ctx.fill();
  if (R.furyT > 0) {
    ctx.strokeStyle = 'rgba(255,110,40,' + (0.5 + 0.3 * Math.sin(R.t * 18)) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 24 + Math.sin(R.t * 12) * 2, 0, TAU); ctx.stroke();
  }
  if (R.coop && !p.local) { // anneau du coéquipier
    ctx.strokeStyle = 'rgba(120,255,160,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke();
  }
  if (p.invuln > 0 && !p.dash && Math.sin(R.t * 40) > 0) ctx.globalAlpha = 0.5;

  if (p.cls === 'samurai') {
    if (p.ultT > 0) {
      const rad = st.ult.radius;
      const fade = clamp(Math.min(p.ultT / 0.2, (p.ultMax - p.ultT + 0.15) / 0.2), 0, 1);
      ctx.save();
      ctx.globalAlpha *= fade;
      const ug = ctx.createRadialGradient(0, 0, rad * 0.3, 0, 0, rad);
      ug.addColorStop(0, 'rgba(120,210,255,0)');
      ug.addColorStop(0.75, 'rgba(130,215,255,0.08)');
      ug.addColorStop(1, 'rgba(180,238,255,0.28)');
      ctx.fillStyle = ug;
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill();
      const slashes = 5;
      for (let i = 0; i < slashes; i++) {
        const speed = (i % 2 === 0 ? 22 : 27);
        const baseA = R.t * speed + i * (TAU / slashes);
        const rBlade = rad * (0.62 + 0.11 * ((i * 3) % 4));
        const span = 1.65, segs = 7;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs, t1 = (s + 1) / segs;
          ctx.strokeStyle = 'rgba(140,225,255,' + (0.06 + 0.48 * t1 * t1) + ')';
          ctx.lineWidth = 1.5 + 6.5 * Math.sin(t1 * Math.PI * 0.85);
          ctx.beginPath();
          ctx.arc(0, 0, rBlade * (0.92 + 0.08 * t1), baseA - span * (1 - t0), baseA - span * (1 - t1));
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(0, 0, rBlade, baseA - span * 0.55, baseA + 0.08); ctx.stroke();
      }
      ctx.restore();
    }
    if (p.dash) {
      ctx.fillStyle = 'rgba(150,220,255,0.3)';
      ctx.beginPath(); ctx.arc(-p.dash.vx * 0.02, -p.dash.vy * 0.02, 16, 0, TAU); ctx.fill();
    }
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
        ctx.strokeStyle = 'rgba(180,235,255,' + (0.1 + 0.5 * t1) + ')';
        ctx.lineWidth = 6 + 10 * t1;
        ctx.beginPath(); ctx.arc(0, 0, range * 0.72, a0 + (aCur - a0) * t0, a0 + (aCur - a0) * t1, sweep < 0); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, range * 0.92, a0, aCur, sweep < 0); ctx.stroke();
      ctx.restore();
    }
    ctx.rotate(p.ultT > 0 ? R.t * 24 : p.angle);
    let sa;
    if (p.ultT > 0) sa = 0.12;
    else if (p.swingT > 0) {
      const k = 1 - p.swingT / p.swingDur;
      sa = angDiff(p.swingAngle, p.angle) + (-p.swingArc / 2 + p.swingArc * Math.min(1, k * 1.3)) * p.swingDir;
    } else sa = 0.85;
    const swordLen = 30 + st.swordRange * 0.35;
    ctx.save();
    ctx.translate(4, 9);
    ctx.rotate(sa);
    ctx.strokeStyle = 'rgba(120,210,255,0.35)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(swordLen, 0); ctx.stroke();
    ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(swordLen, 0); ctx.stroke();
    ctx.fillStyle = '#c9a23a'; ctx.fillRect(5, -4, 3, 8);
    ctx.fillStyle = '#2a1a10'; ctx.fillRect(-4, -1.5, 9, 3);
    ctx.restore();
    const step = p.moving ? Math.sin(p.walkPhase) * 3 : 0;
    ctx.fillStyle = '#1f2c48';
    ctx.beginPath(); ctx.ellipse(-2, 0, 10, 15, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#0c1220'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#7a1f2a'; ctx.fillRect(-4, -14, 3, 28);
    ctx.fillStyle = '#2b3c60';
    ctx.beginPath(); ctx.ellipse(6 + step * 0.3, 9, 6, 4, 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4 - step * 0.3, -10, 6, 4, -0.3, 0, TAU); ctx.fill();
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
    const wlen = { pistol: 14, shotgun: 26, rifle: 30, flamer: 28, launcher: 26, minigun: 32 }[p.weapon] || 14;
    const wcol = { pistol: '#2a2a2a', shotgun: '#5a3a22', rifle: '#2f3a2a', flamer: '#8a2a1a', launcher: '#3e4a2c', minigun: '#444a52' }[p.weapon] || '#2a2a2a';
    ctx.fillStyle = wcol;
    const wth = p.weapon === 'minigun' || p.weapon === 'launcher' || p.weapon === 'flamer' ? 7 : 4.5;
    ctx.fillRect(6 + rec, 6 - wth / 2, wlen, wth);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(6 + rec, 6 - wth / 2, wlen, wth);
    if (p.weapon === 'flamer') { ctx.fillStyle = '#c9a23a'; ctx.fillRect(-12, -6, 7, 12); }
    if (p.muzzle > 0) {
      ctx.fillStyle = 'rgba(255,230,140,0.95)';
      ctx.beginPath(); ctx.moveTo(6 + wlen + rec, 2); ctx.lineTo(6 + wlen + 16 + rec, 6); ctx.lineTo(6 + wlen + rec, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,100,0.35)'; ctx.beginPath(); ctx.arc(6 + wlen + 6, 6, 14, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#4a5a34';
    ctx.beginPath(); ctx.ellipse(-2, 0, 10, 15, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#1e2614'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#5d6e40'; ctx.fillRect(-7, -9, 9, 18);
    ctx.fillStyle = '#3a4628'; ctx.fillRect(-6, -7, 3, 4); ctx.fillRect(-6, 3, 3, 4);
    ctx.fillStyle = '#c99a72';
    ctx.beginPath(); ctx.arc(8 + rec, 6, 3.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(14 + rec, 7, 3.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#4a5a34'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(8 + rec, 6); ctx.moveTo(0, -11); ctx.lineTo(14 + rec, 7); ctx.stroke();
    const hg = ctx.createRadialGradient(-2, -3, 1, 0, 0, 11);
    hg.addColorStop(0, '#6f8250'); hg.addColorStop(1, '#3c4a2a');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(1, 0, 10, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#222b16'; ctx.lineWidth = 1.5; ctx.stroke();
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

function drawMap(mx, my, ms, big) {
  if (mapVersion !== World.version) buildMapCanvas();
  const p = me();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(mx - 3, my - 3, ms + 6, ms + 6);
  ctx.globalAlpha = big ? 0.95 : 0.85;
  ctx.drawImage(mapCv, mx, my, ms, ms);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(mx - 3, my - 3, ms + 6, ms + 6);
  const k = ms / WORLD, N = MAZE_N, cs = PITCH * TILE * k;
  // chaleur de la horde
  const h = R.heat;
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const v = h[cy * N + cx];
    if (!v) continue;
    ctx.fillStyle = 'rgba(255,' + (v > 140 ? 90 : 40) + ',30,' + Math.min(0.85, 0.18 + v / 300) + ')';
    ctx.fillRect(mx + (cx * PITCH + 0.5) * TILE * k, my + (cy * PITCH + 0.5) * TILE * k, cs, cs);
  }
  if (R.shift) {
    for (const [list, col] of [[R.shift.close, '#ff5030'], [R.shift.open, '#5adcff']]) {
      ctx.fillStyle = col;
      for (const id of list) for (const t of World.linkTiles(id)) ctx.fillRect(mx + (t % GW) * TILE * k - 1, my + (t / GW | 0) * TILE * k - 1, TILE * k + 2, TILE * k + 2);
    }
  }
  const dot = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mx + x * k, my + y * k, r, 0, TAU); ctx.fill(); };
  for (const z of R.zombies) if (z.d.boss) dot(z.x, z.y, big ? 6 : 4, '#c060ff');
  for (const c of R.crates) { ctx.fillStyle = '#ffd86a'; ctx.fillRect(mx + c.x * k - 2.5, my + c.y * k - 2.5, 5, 5); }
  if (R.relic) dot(R.relic.x, R.relic.y, (big ? 6 : 4) + Math.sin(R.t * 6), '#d08aff');
  for (const q of R.players) if (!q.gone && !q.local) dot(q.x, q.y, big ? 5 : 3.5, q.down ? '#ff5050' : '#7dff9a');
  dot(p.x, p.y, big ? 5 : 3.5, '#ffffff');
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
  const vw = VW / zoom * k, vh = VH / zoom * k;
  ctx.strokeRect(mx + R.cam.x * k - vw / 2, my + R.cam.y * k - vh / 2, vw, vh);
}

function drawHud() {
  const p = me(), st = p.st;
  const small = VW < 700;
  const s = small ? 0.85 : 1;
  ctx.save();
  const bw = Math.min(260, VW * 0.38) * s;
  const x0 = 14, y0 = 14;
  bar(x0, y0, bw, 18 * s, p.hp / p.maxHp, p.hp < p.maxHp * 0.3 ? '#ff3d3d' : '#d93b3b', 'rgba(0,0,0,0.55)', Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp));
  let y = y0 + 24 * s;
  if (p.cls === 'samurai') {
    bar(x0, y, bw * 0.85, 13 * s, p.energy / st.energyMax, '#3aa0ff', 'rgba(0,0,0,0.55)', 'Ki ' + Math.floor(p.energy), p.energyFlash > 0);
    y += 19 * s;
  } else if (st.grenades) {
    ctx.font = 'bold ' + Math.round(14 * s) + 'px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#e8e0c8';
    ctx.fillText('🧨 ' + p.grenades + ' / ' + st.grenades.max, x0, y + 12 * s);
    y += 19 * s;
  }
  // niveau de la partie
  const need = xpNeed(R.level);
  bar(x0, y, bw * 0.85, 9 * s, R.xp / need, '#e0b040', 'rgba(0,0,0,0.55)');
  ctx.font = 'bold ' + Math.round(12 * s) + 'px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd75a';
  ctx.fillText('Niv. ' + R.level + '  ·  dégâts +' + Math.round((R.dmgMult - 1) * 100) + ' %', x0 + bw * 0.85 + 8, y + 9 * s);
  y += 16 * s;
  // coéquipier
  for (const q of R.players) {
    if (q.local || q.gone) continue;
    ctx.font = 'bold ' + Math.round(11 * s) + 'px system-ui'; ctx.textAlign = 'left';
    ctx.fillStyle = q.down ? '#ff7070' : '#9dffb6';
    ctx.fillText((q.cls === 'samurai' ? '⚔️ Rōnin' : '🎖️ Soldat') + (q.down ? ' — À TERRE' : ''), x0, y + 11 * s);
    bar(x0 + 78 * s, y + 2, bw * 0.5, 10 * s, q.down ? q.reviveT / 3 : q.hp / q.maxHp, q.down ? '#7dff8a' : '#3fae5a', 'rgba(0,0,0,0.55)');
    y += 17 * s;
  }
  if (R.furyT > 0) {
    ctx.font = '900 ' + Math.round(15 * s) + 'px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#ff7a3a';
    ctx.fillText('🔥 FUREUR ' + Math.ceil(R.furyT) + ' s', x0, y + 16 * s);
  }

  // vague
  ctx.textAlign = 'center';
  ctx.font = '900 ' + Math.round(22 * s) + 'px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('VAGUE ' + Math.max(1, R.wave), VW / 2 + 1, 33 * s + 1);
  ctx.fillStyle = '#f2e6d0'; ctx.fillText('VAGUE ' + Math.max(1, R.wave), VW / 2, 33 * s);
  ctx.font = '600 ' + Math.round(13 * s) + 'px system-ui, sans-serif';
  let sub;
  if (R.phase === 'break') sub = 'Prochaine vague dans ' + Math.ceil(R.breakT) + ' s';
  else sub = '🧟 ' + R.left + ' · marée suivante dans ' + Math.max(0, Math.ceil(R.waveT)) + ' s';
  ctx.fillStyle = R.phase === 'fight' && R.waveT < 10 ? '#ff9a7a' : '#c9bfa8'; ctx.fillText(sub, VW / 2, 52 * s);
  if (R.phase === 'fight') bar(VW / 2 - 80 * s, 58 * s, 160 * s, 5 * s, 1 - R.left / Math.max(1, R.normalTotal), '#a83232', 'rgba(0,0,0,0.5)');

  // âmes
  ctx.textAlign = 'right';
  ctx.font = 'bold ' + Math.round(17 * s) + 'px system-ui, sans-serif';
  ctx.fillStyle = '#bfe6ff';
  const right = VW - (touchMode ? 60 : 14);
  ctx.fillText('👻 ' + Math.floor(hooks.getSouls ? hooks.getSouls() : p.souls), right, 30 * s);
  if (VW >= 560) {
    ctx.font = '600 ' + Math.round(13 * s) + 'px system-ui, sans-serif';
    ctx.fillStyle = '#c9bfa8';
    ctx.fillText('+' + Math.floor(p.souls) + ' cette partie · ' + R.kills + ' tués', right, 48 * s);
  }

  // mini-carte / grande carte
  const m = minimapRect();
  if (bigMap) {
    const ms = Math.min(VW, VH) * 0.82;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, VW, VH);
    drawMap((VW - ms) / 2, (VH - ms) / 2, ms, true);
    ctx.font = '600 13px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#c9bfa8';
    ctx.fillText(touchMode ? 'Touchez pour fermer' : 'Tab : fermer la carte', VW / 2, (VH + ms) / 2 + 20);
  } else {
    drawMap(m.x, m.y, m.s, false);
    if (R.coop && Net.connected) {
      const net = Net.stats;
      ctx.font = '600 11px system-ui'; ctx.textAlign = 'right';
      ctx.fillStyle = net.silentMs > 1500 || net.rtt > 180 ? '#ffb56a' : '#a5d5b0';
      const label = net.silentMs > 1500 ? 'Connexion instable' : net.rtt === null ? 'Réseau…' : 'Ping ' + net.rtt + ' ms';
      ctx.fillText(label, m.x + m.s, m.y - 7);
    }
    if (!touchMode && R.t < 30) { ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(220,210,190,0.8)'; ctx.fillText('Tab : grande carte', m.x + m.s / 2, m.y + m.s + 16); }
  }

  // enchaînement
  if (R.combo >= 5) {
    const mult = 1 + Math.min(1, R.combo / 300);
    const cy2 = m.y + m.s + 50;
    ctx.textAlign = 'right';
    ctx.globalAlpha = clamp(R.comboT / 1.2, 0.25, 1);
    ctx.font = '900 ' + Math.round((26 + Math.min(16, R.combo / 25)) * s) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('×' + R.combo, VW - 13, cy2 + 1);
    ctx.fillStyle = R.combo >= 200 ? '#ff5a2a' : R.combo >= 50 ? '#ff9a3a' : '#ffd86a'; ctx.fillText('×' + R.combo, VW - 14, cy2);
    ctx.font = '600 ' + Math.round(12 * s) + 'px system-ui'; ctx.fillStyle = '#e8dcc4';
    ctx.fillText('âmes ×' + mult.toFixed(2).replace('.', ','), VW - 14, cy2 + 16 * s);
    ctx.globalAlpha = 1;
  }

  if (!touchMode) drawSlots(s);
  else if (p.cls === 'soldier') drawWeapons(VW / 2, VH - 40 * s - 12, s * 0.9);

  if (R.banner) {
    const b = R.banner;
    const a = Math.min(1, b.t * 4, (b.dur - b.t) * 2);
    ctx.globalAlpha = Math.max(0, a);
    ctx.textAlign = 'center';
    ctx.font = '900 ' + Math.round(Math.min(50, VW / (Math.max(12, b.text.length) * 0.72))) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(b.text, VW / 2 + 2, VH * 0.27 + 2);
    ctx.fillStyle = '#f5e2c0'; ctx.fillText(b.text, VW / 2, VH * 0.27);
    if (b.sub) {
      ctx.font = '600 ' + Math.round(Math.min(20, VW / 28)) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#e0c9a0'; ctx.fillText(b.sub, VW / 2, VH * 0.27 + 32);
    }
    ctx.globalAlpha = 1;
  }
  if (p.down && !R.over) {
    ctx.textAlign = 'center'; ctx.font = '900 ' + Math.round(Math.min(34, VW / 18)) + 'px system-ui'; ctx.fillStyle = '#ff8a8a';
    ctx.fillText('À TERRE', VW / 2, VH * 0.6);
    ctx.font = '600 15px system-ui'; ctx.fillStyle = '#e8dcc4';
    ctx.fillText('Votre coéquipier doit rester 3 s à côté de vous pour vous relever', VW / 2, VH * 0.6 + 26);
  }

  if (R.hintT > 0 && !touchMode && !bigMap) {
    ctx.globalAlpha = Math.min(1, R.hintT);
    const lines = p.cls === 'samurai'
      ? ['ZQSD / WASD : se déplacer · Tab : carte du labyrinthe', 'Souris : viser · Clic gauche : sabre (coûte du Ki)', 'Clic droit ou E : Poussée' + (st.dash ? ' · Espace : Pas du vent' : ''),
        (st.stasis ? 'F : Stase temporelle' : '') + (st.ult ? ' · R : Tempête de lames' : '')]
      : ['ZQSD / WASD : se déplacer · Tab : carte du labyrinthe', 'Souris : viser · Clic gauche : tirer · 1-6 / molette : arme', 'Les caisses de munitions sont dispersées dans le labyrinthe',
        (st.grenades ? 'Clic droit / E : grenade' : '') + (st.roll ? ' · Espace : roulade' : '') + (st.adren ? ' · F : adrénaline' : '') + (st.turret ? ' · R : tourelle' : '')];
    lines.push('Le rouge sur la carte, c\'est la horde. Les losanges violets sont des reliques.');
    ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center';
    const ls = lines.filter(l => l.trim()), lh = 20, bh = ls.length * lh + 16, by = VH * 0.62;
    const wd = Math.min(560, VW - 20);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(VW / 2 - wd / 2, by, wd, bh, 10); ctx.fill();
    ctx.fillStyle = '#e8dcc4';
    ls.forEach((l, i) => ctx.fillText(l, VW / 2, by + 24 + i * lh, wd - 16));
    ctx.globalAlpha = 1;
  }

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
  const p = me(), st = p.st;
  const list = [];
  const free = R.furyT > 0;
  if (p.cls === 'samurai') {
    list.push({ key: 'Clic', icon: '🗡️', cost: st.swordCost, frac: Math.max(0, p.atkT) / st.swordCd, ready: free || p.energy >= st.swordCost });
    list.push({ key: 'E', icon: '✋', cost: st.push.cost, ready: (free || p.energy >= st.push.cost) && p.pushCd <= 0, frac: p.pushCd / st.push.cd });
    if (st.dash) list.push({ key: 'Esp.', icon: '🍃', cost: st.dash.cost, ready: free || p.energy >= st.dash.cost });
    if (st.stasis) list.push({ key: 'F', icon: '⏳', cost: st.stasis.cost, ready: (free || p.energy >= st.stasis.cost) && p.stasisCd <= 0, frac: p.stasisCd / st.stasis.cd, active: p.stasisT > 0 ? p.stasisT / p.stasisMax : 0 });
    if (st.ult) list.push({ key: 'R', icon: '⚔️', cost: st.ult.cost, ready: (free || p.energy >= st.ult.cost) && p.ultCd <= 0, frac: p.ultCd / (st.ult.cd || 8), active: p.ultT > 0 ? p.ultT / st.ult.dur : 0 });
  } else {
    if (st.grenades) list.push({ key: 'E', icon: '🧨', count: p.grenades, ready: p.grenades > 0, frac: p.nadeCd / 0.35 });
    if (st.roll) list.push({ key: 'Esp.', icon: '🤸', frac: p.rollCd / st.roll.cd, ready: p.rollCd <= 0 });
    if (st.adren) list.push({ key: 'F', icon: '💉', frac: p.adrenCd / st.adren.cd, ready: p.adrenCd <= 0, active: p.adrenT > 0 ? p.adrenT / st.adren.dur : 0 });
    if (st.turret) list.push({ key: 'R', icon: '🗼', frac: p.turretCd / st.turret.cd, ready: p.turretCd <= 0 });
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
  if (sl.active) { ctx.fillStyle = '#7cc8ff'; ctx.fillRect(x + 4, y + sz - 5, (sz - 8) * sl.active, 3); }
  ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#ffe9b0'; ctx.textAlign = 'left';
  ctx.fillText(sl.key, x + 4, y + 12);
  if (sl.cost !== undefined) { ctx.textAlign = 'right'; ctx.fillStyle = '#9fd0ff'; ctx.fillText(Math.round(sl.cost), x + sz - 4, y + sz - 6); }
  if (sl.count !== undefined) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 12px system-ui'; ctx.fillText(sl.count, x + sz - 4, y + sz - 5); }
}

function drawWeapons(cx, y, s) {
  const p = me(), st = p.st;
  const list = availableWeapons(p);
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
  const y = VH - sz - 14;
  if (me().cls === 'soldier') drawWeapons(VW / 2, VH - 40 * s - 14 - (list.length ? sz + 10 : 0), s);
  const total = list.length * sz + (list.length - 1) * gap;
  let x = VW / 2 - total / 2;
  for (const sl of list) { drawSlot(x, y, sz, sl); x += sz + gap; }
}
