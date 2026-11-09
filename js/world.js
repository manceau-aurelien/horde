'use strict';
/* HORDE — le labyrinthe : génération à partir d'une graine, collisions, champ de flux, reconfiguration. */

const TILE = 48;          // taille d'une tuile en pixels
const MAZE_N = 19;        // cellules par côté
const PITCH = 4;          // 3 tuiles de couloir + 1 tuile de mur
const GW = MAZE_N * PITCH + 1;
const WORLD = GW * TILE;  // taille du monde en pixels

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const World = (() => {
  const N = MAZE_N;
  const solid = new Uint8Array(GW * GW);
  const roomT = new Uint8Array(GW * GW);   // tuiles de salle (sol différent)
  const dist = new Uint16Array(GW * GW);   // distance (en tuiles) au joueur le plus proche
  const nextT = new Int32Array(GW * GW);   // tuile suivante vers le joueur
  const queue = new Int32Array(GW * GW);
  // liens entre cellules : [0, N*N) = vers la droite, [N*N, 2*N*N) = vers le bas
  const link = new Uint8Array(2 * N * N);
  const locked = new Uint8Array(2 * N * N); // liens de salles : jamais refermés
  let rooms = [];
  let version = 0;

  const H = (cx, cy) => cy * N + cx;
  const V = (cx, cy) => N * N + cy * N + cx;
  const validLink = id => {
    if (id < N * N) return id % N < N - 1;
    return ((id - N * N) / N | 0) < N - 1;
  };
  function linkCells(id) {
    if (id < N * N) { const cx = id % N, cy = id / N | 0; return [cx, cy, cx + 1, cy]; }
    const k = id - N * N, cx = k % N, cy = k / N | 0;
    return [cx, cy, cx, cy + 1];
  }
  function linkTiles(id) {
    const out = [];
    if (id < N * N) {
      const cx = id % N, cy = id / N | 0, x = (cx + 1) * PITCH;
      for (let i = 1; i <= 3; i++) out.push((cy * PITCH + i) * GW + x);
    } else {
      const k = id - N * N, cx = k % N, cy = k / N | 0, y = (cy + 1) * PITCH;
      for (let i = 1; i <= 3; i++) out.push(y * GW + cx * PITCH + i);
    }
    return out;
  }
  function cellLinks(cx, cy) {
    const out = [];
    if (cx < N - 1) out.push(H(cx, cy));
    if (cx > 0) out.push(H(cx - 1, cy));
    if (cy < N - 1) out.push(V(cx, cy));
    if (cy > 0) out.push(V(cx, cy - 1));
    return out;
  }
  const degree = (cx, cy) => cellLinks(cx, cy).reduce((n, id) => n + link[id], 0);
  function setLink(id, open) {
    link[id] = open ? 1 : 0;
    for (const t of linkTiles(id)) solid[t] = open ? 0 : 1;
  }

  function generate(seed) {
    const rng = mulberry32(seed);
    solid.fill(1); roomT.fill(0); link.fill(0); locked.fill(0);
    rooms = [];
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++)
      for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) solid[(cy * PITCH + j) * GW + cx * PITCH + i] = 0;

    // labyrinthe parfait (parcours en profondeur)
    const seen = new Uint8Array(N * N);
    const stack = [H(N >> 1, N >> 1)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1], cx = c % N, cy = c / N | 0;
      const opts = [];
      if (cx < N - 1 && !seen[c + 1]) opts.push([c + 1, H(cx, cy)]);
      if (cx > 0 && !seen[c - 1]) opts.push([c - 1, H(cx - 1, cy)]);
      if (cy < N - 1 && !seen[c + N]) opts.push([c + N, V(cx, cy)]);
      if (cy > 0 && !seen[c - N]) opts.push([c - N, V(cx, cy - 1)]);
      if (!opts.length) { stack.pop(); continue; }
      const [nc, id] = opts[(rng() * opts.length) | 0];
      seen[nc] = 1; setLink(id, true); stack.push(nc);
    }
    // plus aucun cul-de-sac : on peut toujours fuir… ou être pris en tenaille
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      let guard = 0;
      while (degree(cx, cy) < 2 && guard++ < 8) {
        const closed = cellLinks(cx, cy).filter(id => !link[id]);
        if (!closed.length) break;
        setLink(closed[(rng() * closed.length) | 0], true);
      }
    }
    // boucles supplémentaires
    for (let id = 0; id < 2 * N * N; id++) if (validLink(id) && !link[id] && rng() < 0.09) setLink(id, true);

    // salles : une grande place centrale et quelques places secondaires
    const carve = (cx, cy, w, h) => {
      for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) {
        if (x < cx + w - 1) { setLink(H(x, y), true); locked[H(x, y)] = 1; }
        if (y < cy + h - 1) { setLink(V(x, y), true); locked[V(x, y)] = 1; }
      }
      for (let ty = cy * PITCH + 1; ty < (cy + h) * PITCH; ty++)
        for (let tx = cx * PITCH + 1; tx < (cx + w) * PITCH; tx++) { solid[ty * GW + tx] = 0; roomT[ty * GW + tx] = 1; }
      rooms.push({ cx, cy, w, h, x: (cx + w / 2) * PITCH * TILE + TILE / 2, y: (cy + h / 2) * PITCH * TILE + TILE / 2 });
    };
    const c = (N >> 1) - 1;
    carve(c, c, 3, 3);
    for (let tries = 0; rooms.length < 9 && tries < 300; tries++) {
      const cx = 1 + (rng() * (N - 3)) | 0, cy = 1 + (rng() * (N - 3)) | 0;
      if (rooms.some(r => Math.abs(r.cx + r.w / 2 - cx - 1) < 4.5 && Math.abs(r.cy + r.h / 2 - cy - 1) < 4.5)) continue;
      carve(cx, cy, 2, 2);
    }
    version++;
    return rooms;
  }

  const solidAt = (x, y) => {
    const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
    return x < 0 || y < 0 || tx >= GW || ty >= GW || solid[ty * GW + tx] === 1;
  };
  const tileSolid = (tx, ty) => tx < 0 || ty < 0 || tx >= GW || ty >= GW || solid[ty * GW + tx] === 1;

  // Repousse un cercle hors des murs.
  function collide(e, r) {
    let hit = false;
    const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
    const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!tileSolid(tx, ty)) continue;
      const bx = tx * TILE, by = ty * TILE;
      const cx = e.x < bx ? bx : e.x > bx + TILE ? bx + TILE : e.x;
      const cy = e.y < by ? by : e.y > by + TILE ? by + TILE : e.y;
      const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        e.x = cx + dx / d * r; e.y = cy + dy / d * r;
      } else {
        // centre dans le mur : sortir par le côté libre le plus proche
        let best = 1e9, ox = 0, oy = 0;
        const tryS = (free, pen, sx, sy) => { if (free && pen < best) { best = pen; ox = sx * pen; oy = sy * pen; } };
        tryS(!tileSolid(tx - 1, ty), e.x - bx + r, -1, 0);
        tryS(!tileSolid(tx + 1, ty), bx + TILE - e.x + r, 1, 0);
        tryS(!tileSolid(tx, ty - 1), e.y - by + r, 0, -1);
        tryS(!tileSolid(tx, ty + 1), by + TILE - e.y + r, 0, 1);
        if (best < 1e9) { e.x += ox; e.y += oy; }
        else { // au cœur d'un bloc : vers le centre de la cellule la plus proche
          const ccx = Math.min(N - 1, Math.max(0, Math.round((e.x / TILE - 2.5) / PITCH)));
          const ccy = Math.min(N - 1, Math.max(0, Math.round((e.y / TILE - 2.5) / PITCH)));
          e.x = (ccx * PITCH + 2.5) * TILE; e.y = (ccy * PITCH + 2.5) * TILE;
        }
      }
    }
    return hit;
  }

  // Ligne de vue entre deux points.
  function los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 16);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (solidAt(x0 + dx * k, y0 + dy * k)) return false;
    }
    return true;
  }

  // Champ de flux : distance de chaque tuile au joueur le plus proche, par les couloirs.
  function flow(sources) {
    dist.fill(65535);
    let qh = 0, qt = 0;
    for (const s of sources) {
      const tx = (s.x / TILE) | 0, ty = (s.y / TILE) | 0;
      if (tileSolid(tx, ty)) continue;
      const t = ty * GW + tx;
      if (dist[t] !== 0) { dist[t] = 0; queue[qt++] = t; }
    }
    while (qh < qt) {
      const t = queue[qh++], d = dist[t] + 1;
      let n = t - 1; if (!solid[n] && dist[n] > d) { dist[n] = d; queue[qt++] = n; }
      n = t + 1; if (!solid[n] && dist[n] > d) { dist[n] = d; queue[qt++] = n; }
      n = t - GW; if (!solid[n] && dist[n] > d) { dist[n] = d; queue[qt++] = n; }
      n = t + GW; if (!solid[n] && dist[n] > d) { dist[n] = d; queue[qt++] = n; }
    }
    for (let i = 0; i < qt; i++) {
      const t = queue[i];
      let best = t, bd = dist[t];
      const l = !solid[t - 1], r = !solid[t + 1], u = !solid[t - GW], dn = !solid[t + GW];
      if (l && dist[t - 1] < bd) { bd = dist[t - 1]; best = t - 1; }
      if (r && dist[t + 1] < bd) { bd = dist[t + 1]; best = t + 1; }
      if (u && dist[t - GW] < bd) { bd = dist[t - GW]; best = t - GW; }
      if (dn && dist[t + GW] < bd) { bd = dist[t + GW]; best = t + GW; }
      if (l && u && !solid[t - GW - 1] && dist[t - GW - 1] < bd) { bd = dist[t - GW - 1]; best = t - GW - 1; }
      if (r && u && !solid[t - GW + 1] && dist[t - GW + 1] < bd) { bd = dist[t - GW + 1]; best = t - GW + 1; }
      if (l && dn && !solid[t + GW - 1] && dist[t + GW - 1] < bd) { bd = dist[t + GW - 1]; best = t + GW - 1; }
      if (r && dn && !solid[t + GW + 1] && dist[t + GW + 1] < bd) { bd = dist[t + GW + 1]; best = t + GW + 1; }
      nextT[t] = best;
    }
  }

  function connected() {
    const seen = new Uint8Array(N * N);
    const st = [0]; seen[0] = 1; let n = 1;
    while (st.length) {
      const c = st.pop(), cx = c % N, cy = c / N | 0;
      const go = (nc, id) => { if (link[id] && !seen[nc]) { seen[nc] = 1; n++; st.push(nc); } };
      if (cx < N - 1) go(c + 1, H(cx, cy));
      if (cx > 0) go(c - 1, H(cx - 1, cy));
      if (cy < N - 1) go(c + N, V(cx, cy));
      if (cy > 0) go(c - N, V(cx, cy - 1));
    }
    return n === N * N;
  }

  // Prépare une reconfiguration : k murs s'ouvrent, k passages se ferment (loin des joueurs).
  function planShift(k, avoid) {
    const cellOf = v => Math.min(N - 1, Math.max(0, ((v / TILE) / PITCH) | 0));
    const nearAvoid = id => {
      const [ax, ay, bx, by] = linkCells(id);
      return avoid.some(p => {
        const px = cellOf(p.x), py = cellOf(p.y);
        return (Math.abs(px - ax) <= 2 && Math.abs(py - ay) <= 2) || (Math.abs(px - bx) <= 2 && Math.abs(py - by) <= 2);
      });
    };
    const open = [], close = [];
    for (let tries = 0; close.length < k && tries < 400; tries++) {
      const id = (Math.random() * 2 * N * N) | 0;
      if (!validLink(id) || !link[id] || locked[id] || close.includes(id) || nearAvoid(id)) continue;
      const [ax, ay, bx, by] = linkCells(id);
      link[id] = 0;
      const ok = degree(ax, ay) >= 2 && degree(bx, by) >= 2 && connected();
      if (ok) close.push(id); else link[id] = 1;
    }
    for (const id of close) link[id] = 1; // on ne fait que planifier
    for (let tries = 0; open.length < k && tries < 400; tries++) {
      const id = (Math.random() * 2 * N * N) | 0;
      if (!validLink(id) || link[id] || open.includes(id)) continue;
      open.push(id);
    }
    return { open, close };
  }
  function applyShift(plan) {
    for (const id of plan.open) setLink(id, true);
    for (const id of plan.close) setLink(id, false);
    version++;
  }

  const cellCenter = (cx, cy) => ({ x: (cx * PITCH + 2.5) * TILE, y: (cy * PITCH + 2.5) * TILE });

  return {
    N, solid, roomT, dist, nextT, link, generate, solidAt, tileSolid, collide, los, flow, planShift, applyShift,
    linkTiles, cellCenter,
    get rooms() { return rooms; }, get version() { return version; },
  };
})();
