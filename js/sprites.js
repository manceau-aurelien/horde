'use strict';
/* Sprites pré-dessinés : zombies, sol post-apocalyptique, ruines, murs cassés, barricades, épaves. */

const Sprites = (() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  let seed = 1234567;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const LOOK = {
    walker:  { skins: ['#7f9a6b', '#8a9a74', '#748f69', '#90a07a'], shirts: ['#4d3f33', '#34465f', '#5e3434', '#444444', '#55603a'] },
    crawler: { skins: ['#a8947a', '#9c8a8a', '#b09a72'], shirts: ['#3a2a2a', '#2e2e38'] },
    runner:  { skins: ['#9db07e', '#a6b38a'], shirts: ['#7a2e2e', '#2f4f4f', '#3f3f5a'] },
    boomer:  { skins: ['#b6c25e', '#c0bf63'], shirts: ['#6a6a3a'] },
    brute:   { skins: ['#6b7a55', '#64704f'], shirts: ['#2c2c2c', '#3a2a22'] },
    spitter: { skins: ['#6aa46a', '#5f9c6c'], shirts: ['#2f3d2a', '#3c3c2a'] },
    boss:    { skins: ['#7d6b86'], shirts: ['#2a1f2e'] },
  };

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawZombie(type, r, skin, shirt, white) {
    const pad = Math.ceil(r * 1.4);
    const S = (r + pad) * 2;
    const c = mk(S, S), g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    const W = white ? '#ffffff' : null;
    const outline = white ? '#ffffff' : 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(1.5, r * 0.12);
    g.strokeStyle = outline;

    // Bras tendus vers l'avant
    const armLen = type === 'brute' || type === 'boss' ? r * 1.15 : r * 1.25;
    const armW = type === 'brute' || type === 'boss' ? r * 0.36 : r * 0.28;
    const armY = type === 'boomer' ? r * 0.75 : r * 0.62;
    for (const sy of [-1, 1]) {
      g.fillStyle = W || skin;
      g.beginPath();
      const off = sy === 1 ? r * 0.12 : 0;
      g.roundRect(r * 0.05 + off, sy * armY - armW / 2, armLen, armW, armW / 2);
      g.fill(); g.stroke();
      g.fillStyle = W || shade(skin, 0.85);
      g.beginPath(); g.arc(r * 0.05 + off + armLen, sy * armY, armW * 0.62, 0, Math.PI * 2); g.fill(); g.stroke();
    }

    // Corps
    g.fillStyle = W || shirt;
    g.beginPath();
    if (type === 'boomer') g.ellipse(-r * 0.05, 0, r * 0.95, r * 0.95, 0, 0, Math.PI * 2);
    else if (type === 'brute' || type === 'boss') g.ellipse(-r * 0.1, 0, r * 0.7, r * 1.08, 0, 0, Math.PI * 2);
    else g.ellipse(-r * 0.1, 0, r * 0.55, r * 0.92, 0, 0, Math.PI * 2);
    g.fill(); g.stroke();
    if (!white) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.arc(-r * 0.3 + rnd() * r * 0.4, (rnd() - 0.5) * r * 1.2, r * (0.1 + rnd() * 0.12), 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(120,10,10,0.55)';
      g.beginPath(); g.arc(-r * 0.1 + rnd() * r * 0.2, (rnd() - 0.5) * r, r * 0.16, 0, Math.PI * 2); g.fill();
      if (type === 'boomer') {
        g.fillStyle = '#d9e07a';
        for (let i = 0; i < 6; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * r * 0.7;
          g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.08 + rnd() * 0.08), 0, Math.PI * 2); g.fill();
        }
      }
      if (type === 'boss') {
        g.fillStyle = '#c9b3d1';
        for (const sy of [-1, 1]) for (let i = 0; i < 3; i++) {
          g.beginPath();
          const bx = -r * 0.5 + i * r * 0.3, by = sy * r * 0.85;
          g.moveTo(bx - r * 0.1, by); g.lineTo(bx, by + sy * r * 0.35); g.lineTo(bx + r * 0.1, by); g.fill();
        }
      }
    }

    // Tête
    const hr = type === 'boomer' ? r * 0.42 : type === 'brute' || type === 'boss' ? r * 0.45 : r * 0.5;
    const hx = type === 'boomer' ? r * 0.55 : r * 0.18;
    g.fillStyle = W || skin;
    g.beginPath(); g.arc(hx, 0, hr, 0, Math.PI * 2); g.fill(); g.stroke();
    if (!white) {
      g.fillStyle = shade(skin, 0.55);
      g.beginPath(); g.arc(hx - hr * 0.35, 0, hr * 0.62, Math.PI * 0.55, Math.PI * 1.45); g.fill();
      g.fillStyle = type === 'spitter' ? '#c8ff5a' : type === 'boss' ? '#ff4040' : '#e8f0a0';
      g.beginPath(); g.arc(hx + hr * 0.55, -hr * 0.38, hr * 0.17, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(hx + hr * 0.55, hr * 0.38, hr * 0.17, 0, Math.PI * 2); g.fill();
      if (type === 'spitter') {
        g.fillStyle = '#9cff3a';
        g.beginPath(); g.arc(hx + hr * 0.85, 0, hr * 0.25, 0, Math.PI * 2); g.fill();
      }
    }
    return c;
  }

  const zombies = {};
  function buildZombies() {
    for (const type in ZTYPES) {
      const r = ZTYPES[type].r;
      const look = LOOK[type];
      zombies[type] = [];
      for (let i = 0; i < 4; i++) {
        const skin = look.skins[i % look.skins.length];
        const shirt = look.shirts[(i * 3 + 1) % look.shirts.length];
        const s = seed;
        const normal = drawZombie(type, r, skin, shirt, false);
        seed = s;
        const white = drawZombie(type, r, skin, shirt, true);
        zombies[type].push({ normal, white });
      }
    }
  }

  /* --- Sol post-apocalyptique (bitume fissuré, terre brûlée, gravats) --- */
  let groundTile = null;
  function buildGround() {
    const T = 512;
    const c = mk(T, T), g = c.getContext('2d');
    g.fillStyle = '#252320';
    g.fillRect(0, 0, T, T);
    const blob = (x, y, rad, col) => {
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    };
    // Plaques de poussière ocre, cendre noire et béton usé
    for (let i = 0; i < 24; i++) blob(rnd() * T, rnd() * T, 45 + rnd() * 95, 'rgba(62,50,38,0.38)');
    for (let i = 0; i < 18; i++) blob(rnd() * T, rnd() * T, 35 + rnd() * 80, 'rgba(46,46,44,0.42)');
    for (let i = 0; i < 12; i++) blob(rnd() * T, rnd() * T, 25 + rnd() * 55, 'rgba(18,16,14,0.45)');
    // Grain minéral
    for (let i = 0; i < 1800; i++) {
      const x = rnd() * T, y = rnd() * T;
      g.fillStyle = rnd() < 0.45 ? 'rgba(95,85,72,0.3)' : rnd() < 0.7 ? 'rgba(15,14,12,0.4)' : 'rgba(125,75,55,0.22)';
      g.fillRect(x, y, 1 + rnd() * 2.2, 1 + rnd() * 2.2);
    }
    // Fissures dans le bitume
    g.strokeStyle = 'rgba(12,11,10,0.65)';
    g.lineWidth = 1.3;
    for (let i = 0; i < 28; i++) {
      let x = rnd() * T, y = rnd() * T, a = rnd() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        a += (rnd() - 0.5) * 1.1;
        x += Math.cos(a) * (8 + rnd() * 14);
        y += Math.sin(a) * (8 + rnd() * 14);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Herbes sèches / ronces mortes
    g.strokeStyle = 'rgba(92,82,52,0.45)'; g.lineWidth = 1;
    for (let i = 0; i < 85; i++) {
      const x = rnd() * T, y = rnd() * T;
      for (let k = 0; k < 3; k++) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 9, y - 2 - rnd() * 5); g.stroke();
      }
    }
    // Gravats, éclats de briques et cailloux
    for (let i = 0; i < 95; i++) {
      const brick = rnd() < 0.35;
      g.fillStyle = brick
        ? 'rgba(' + (115 + (rnd() * 30 | 0)) + ',' + (52 + (rnd() * 20 | 0)) + ',38,' + (0.28 + rnd() * 0.3) + ')'
        : 'rgba(115,112,104,' + (0.22 + rnd() * 0.3) + ')';
      const x = rnd() * T, y = rnd() * T, r = 1.2 + rnd() * 2.8;
      if (brick) g.fillRect(x, y, r * 1.6, r);
      else { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    }
    groundTile = c;
  }

  /* --- Sol intérieur des maisons cassées --- */
  function houseFloor(w, h, style = 0) {
    const c = mk(w, h), g = c.getContext('2d');
    const isWood = style % 2 === 1;
    g.fillStyle = isWood ? '#2d231b' : '#2f2d2a';
    g.fillRect(0, 0, w, h);

    if (isWood) {
      // Planches de bois cassées et brûlées
      g.strokeStyle = 'rgba(15,10,6,0.55)';
      g.lineWidth = 1;
      const plankH = 14;
      for (let y = 0; y < h; y += plankH) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        for (let x = (y * 17) % 55; x < w; x += 48 + (rnd() * 35 | 0)) {
          g.beginPath(); g.moveTo(x, y); g.lineTo(x, Math.min(h, y + plankH)); g.stroke();
        }
      }
      // Trous dans le plancher laissant voir la terre
      g.fillStyle = 'rgba(20,18,15,0.75)';
      for (let i = 0; i < 6; i++) {
        const rx = 20 + rnd() * (w - 60), ry = 20 + rnd() * (h - 40);
        g.fillRect(rx, ry, 22 + rnd() * 35, plankH * (1 + (rnd() * 2 | 0)));
      }
    } else {
      // Dalles de béton fissurées
      g.strokeStyle = 'rgba(18,17,15,0.45)';
      g.lineWidth = 1;
      const tile = 36;
      for (let x = tile; x < w; x += tile) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = tile; y < h; y += tile) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }

    // Traces d'incendie et gravats intérieurs
    for (let i = 0; i < 5; i++) {
      const sx = rnd() * w, sy = rnd() * h, sr = 25 + rnd() * 45;
      const gr = g.createRadialGradient(sx, sy, 2, sx, sy, sr);
      gr.addColorStop(0, 'rgba(12,10,8,0.55)');
      gr.addColorStop(1, 'rgba(12,10,8,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
    }
    // Briques et débris éparpillés près des bords
    for (let i = 0; i < 45; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(120,58,42,0.48)' : 'rgba(110,106,98,0.42)';
      const bx = rnd() * w, by = rnd() * h;
      g.save();
      g.translate(bx, by); g.rotate(rnd() * Math.PI);
      g.fillRect(-4, -2, 6 + rnd() * 5, 3 + rnd() * 3);
      g.restore();
    }
    // Bordure de fondation effritée
    g.strokeStyle = 'rgba(10,9,8,0.6)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    return c;
  }

  /* --- Mur de maison en ruine (rectangulaire, horizontal ou vertical) --- */
  function wall(w, h, theme = 0) {
    const pad = 14;
    const c = mk(w + pad * 2, h + pad * 2), g = c.getContext('2d');
    g.translate(pad, pad);

    // Ombre portée au sol
    g.fillStyle = 'rgba(0,0,0,0.48)';
    g.beginPath(); g.roundRect(5, 6, w, h, 4); g.fill();

    // Gravats qui débordent aux extrémités brisées
    const horiz = w >= h;
    for (const end of [0, 1]) {
      const ex = horiz ? (end ? w : 0) : w / 2;
      const ey = horiz ? h / 2 : (end ? h : 0);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? '#594e46' : '#733e30';
        const ox = ex + (rnd() - 0.5) * 16, oy = ey + (rnd() - 0.5) * 16;
        g.beginPath(); g.arc(ox, oy, 3 + rnd() * 4, 0, Math.PI * 2); g.fill();
      }
    }

    // Corps du mur (béton armé ou brique ancienne)
    const palettes = [
      ['#5a4a42', '#3e332d', '#7a3f30'], // brique sombre
      ['#52504c', '#383633', '#68645e'], // béton gris
      ['#5e503f', '#3f3529', '#785a3c'], // crépi ocre délabré
    ];
    const [colTop, colDark, colAccent] = palettes[theme % palettes.length];
    const gr = g.createLinearGradient(0, 0, horiz ? 0 : w, horiz ? h : 0);
    gr.addColorStop(0, colTop);
    gr.addColorStop(1, colDark);
    g.fillStyle = gr;
    g.beginPath(); g.roundRect(0, 0, w, h, 4); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 2;
    g.stroke();

    // Briques apparentes et fissures sur le dessus du mur
    const steps = Math.max(2, Math.floor((horiz ? w : h) / 22));
    for (let i = 0; i < steps; i++) {
      g.fillStyle = rnd() < 0.6 ? colAccent : 'rgba(25,22,20,0.45)';
      const bx = horiz ? 6 + i * 21 + rnd() * 6 : 3 + rnd() * Math.max(2, w - 12);
      const by = horiz ? 3 + rnd() * Math.max(2, h - 10) : 6 + i * 21 + rnd() * 6;
      g.fillRect(bx, by, horiz ? 10 : 6, horiz ? 5 : 10);
    }

    // Fers à béton tordus aux brèches
    g.strokeStyle = '#6e6259';
    g.lineWidth = 1.5;
    for (const dir of [-1, 1]) {
      if (horiz) {
        const rx = dir < 0 ? 2 : w - 2;
        g.beginPath(); g.moveTo(rx, h * 0.3); g.lineTo(rx + dir * 7, h * 0.25);
        g.moveTo(rx, h * 0.7); g.lineTo(rx + dir * 6, h * 0.78); g.stroke();
      } else {
        const ry = dir < 0 ? 2 : h - 2;
        g.beginPath(); g.moveTo(w * 0.3, ry); g.lineTo(w * 0.25, ry + dir * 7);
        g.moveTo(w * 0.7, ry); g.lineTo(w * 0.78, ry + dir * 6); g.stroke();
      }
    }

    // Rebord éclairé
    g.strokeStyle = 'rgba(255,240,220,0.14)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(3, 2); g.lineTo(w - 3, 2); g.stroke();
    return c;
  }

  /* --- Barricade de fortune (sacs de sable, tôles rouillées, poutres) --- */
  function barricade(w, h, vertical) {
    const W = vertical ? h : w, H = vertical ? w : h;
    const c = mk(W + 16, H + 16), g = c.getContext('2d');
    g.translate((W + 16) / 2, (H + 16) / 2);
    if (vertical) g.rotate(Math.PI / 2);

    // Ombre
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.beginPath(); g.roundRect(-w / 2 + 4, -h / 2 + 5, w, h, 6); g.fill();

    // Tôle ondulée rouillée en dessous
    g.fillStyle = '#4e3b30';
    g.fillRect(-w / 2 + 2, -h / 2 + 1, w - 4, h - 2);
    g.strokeStyle = '#2b1e16'; g.lineWidth = 1.5;
    g.strokeRect(-w / 2 + 2, -h / 2 + 1, w - 4, h - 2);

    // Sacs de sable / blocs de béton empilés
    const cols = ['#7a6e54', '#6d624a', '#85785c'];
    const nx = Math.max(2, Math.floor(w / 22));
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < nx; i++) {
        g.fillStyle = cols[(i + row) % cols.length];
        const sx = -w / 2 + 5 + i * ((w - 10) / nx) + (row ? 3 : -2);
        const sy = -h / 2 + 2 + row * (h * 0.42);
        const sw = (w - 12) / nx - 2, sh = h * 0.46;
        g.beginPath(); g.roundRect(sx, sy, sw, sh, 4); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.2; g.stroke();
      }
    }
    // Planche cloutée en travers
    g.fillStyle = '#5c4128';
    g.save(); g.rotate(-0.06);
    g.fillRect(-w * 0.42, -3, w * 0.84, 6);
    g.restore();
    return c;
  }

  /* --- Gravats / décombres de béton --- */
  function rock(r) {
    const S = Math.ceil(r * 2 + 18), c = mk(S, S), g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath(); g.ellipse(5, 6, r * 1.02, r * 0.9, 0, 0, Math.PI * 2); g.fill();
    const pts = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const d = r * (0.8 + rnd() * 0.24);
      pts.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    const gr = g.createLinearGradient(-r, -r, r, r);
    gr.addColorStop(0, '#78736c'); gr.addColorStop(1, '#3e3b37');
    g.fillStyle = gr;
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.stroke();
    // Éclats de briques et ferraille dans le tas de gravats
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#7a3b2e' : '#57534e';
      g.fillRect((rnd() - 0.5) * r, (rnd() - 0.5) * r, 7 + rnd() * 6, 4 + rnd() * 4);
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-r * 0.4, -r * 0.2); g.lineTo(r * 0.15, -r * 0.45); g.stroke();
    return c;
  }

  /* --- Arbre mort / calciné post-apocalyptique --- */
  function tree(r) {
    const R = r * 2.2;
    const S = Math.ceil(R * 2 + 20), c = mk(S, S), g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    // Quelques touffes de feuillage sec / cendré clairsemé
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * R * 0.45, rr = R * (0.32 + rnd() * 0.2);
      g.fillStyle = i < 2 ? 'rgba(32,28,22,0.82)' : 'rgba(' + (55 + rnd() * 20 | 0) + ',' + (48 + rnd() * 18 | 0) + ',' + (30 + rnd() * 12 | 0) + ',0.78)';
      g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2); g.fill();
    }
    // Branches mortes tortueuses
    g.strokeStyle = '#2d2219';
    g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const len = R * (0.65 + rnd() * 0.3);
      g.lineWidth = 4;
      const mx = Math.cos(a) * len * 0.55, my = Math.sin(a) * len * 0.55;
      const ex = Math.cos(a + 0.15) * len, ey = Math.sin(a + 0.15) * len;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(mx, my); g.lineTo(ex, ey); g.stroke();
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a - 0.5) * len * 0.35, my + Math.sin(a - 0.5) * len * 0.35); g.stroke();
    }
    return c;
  }

  /* --- Épave de voiture calcinée / rouillée --- */
  function car(w, h, vertical) {
    const W = vertical ? h : w, H = vertical ? w : h;
    const c = mk(W + 16, H + 16), g = c.getContext('2d');
    g.translate((W + 16) / 2, (H + 16) / 2);
    if (vertical) g.rotate(Math.PI / 2);
    const colors = ['#592a24', '#2b3d52', '#4c4a43', '#5c4b26', '#354733'];
    const col = colors[(rnd() * colors.length) | 0];
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath(); g.roundRect(-w / 2 + 5, -h / 2 + 6, w, h, 10); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.68)'; g.lineWidth = 2; g.stroke();
    // Rouille et brûlures
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i < 3 ? 'rgba(20,18,16,0.45)' : 'rgba(115,52,18,' + (0.35 + rnd() * 0.3) + ')';
      g.beginPath(); g.arc((rnd() - 0.5) * w * 0.9, (rnd() - 0.5) * h * 0.8, 4 + rnd() * 8, 0, Math.PI * 2); g.fill();
    }
    // Pare-brise éclaté et toit cabossé
    g.fillStyle = '#15191d';
    g.beginPath(); g.roundRect(w * 0.08, -h * 0.38, w * 0.16, h * 0.76, 4); g.fill();
    g.beginPath(); g.roundRect(-w * 0.32, -h * 0.36, w * 0.1, h * 0.72, 4); g.fill();
    g.fillStyle = shade(col, 1.18);
    g.beginPath(); g.roundRect(-w * 0.2, -h * 0.4, w * 0.26, h * 0.8, 6); g.fill();
    g.strokeStyle = 'rgba(190,210,220,0.4)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(w * 0.12, -h * 0.2); g.lineTo(w * 0.2, h * 0.1); g.lineTo(w * 0.14, h * 0.3); g.stroke();
    g.fillStyle = '#8c8565';
    g.fillRect(w / 2 - 5, -h * 0.38, 4, 8); g.fillRect(w / 2 - 5, h * 0.38 - 8, 4, 8);
    return c;
  }

  function barrel(r) {
    const S = Math.ceil(r * 2 + 12), c = mk(S, S), g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(3, 4, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6e341b'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2e1509'; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.65, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#b88f2e'; g.beginPath(); g.arc(r * 0.3, -r * 0.3, r * 0.16, 0, Math.PI * 2); g.fill();
    return c;
  }

  function build() {
    seed = 1234567;
    buildZombies();
    buildGround();
  }

  return {
    build, zombies,
    get groundTile() { return groundTile; },
    rock, tree, car, barrel, wall, houseFloor, barricade,
    rnd, setSeed: s => { seed = s; },
  };
})();
