'use strict';
/* HORDE — menus, arbre de compétences, sauvegarde. */

const Save = (() => {
  const blank = () => ({
    v: 1, souls: 0, cls: 'samurai',
    levels: { samurai: {}, soldier: {} },
    best: { samurai: 0, soldier: 0 },
    totals: { kills: 0, runs: 0, souls: 0 },
    settings: { volume: 0.6, muted: false, dmgNumbers: true, shake: true, autoAim: false, autoAttack: false },
  });
  /* Plusieurs parties nommées (une par coéquipier, par exemple).
     La première garde l'ancienne clé : une progression existante devient « Ma partie ».
     Les réglages (son, visée…) suivent le joueur d'une partie à l'autre. */
  const PROFILES_KEY = 'horde-profiles-v1';
  const MAIN = 'main';
  const keyOf = id => (id === MAIN ? SAVE_KEY : SAVE_KEY + ':' + id);
  const cleanName = (name, fallback) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24) || fallback;
  let index = { active: MAIN, list: [{ id: MAIN, name: 'Ma partie', created: Date.now() }] };
  let data = blank();
  let dirty = false;

  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; /* stockage indisponible */ }
  }
  function normalize(d) {
    const b = blank();
    if (!d || typeof d !== 'object') return b;
    const out = Object.assign(b, d);
    out.levels = Object.assign(blank().levels, d.levels || {});
    out.best = Object.assign(blank().best, d.best || {});
    out.totals = Object.assign(blank().totals, d.totals || {});
    out.settings = Object.assign(blank().settings, d.settings || {});
    return out;
  }
  function load() {
    const ix = readJSON(PROFILES_KEY);
    if (ix && Array.isArray(ix.list) && ix.list.length) index = ix;
    if (!index.list.some(p => p.id === index.active)) index.active = index.list[0].id;
    data = normalize(readJSON(keyOf(index.active)));
  }
  function save() {
    data.lastPlayed = Date.now();
    if (writeJSON(keyOf(index.active), data)) dirty = false;
    writeJSON(PROFILES_KEY, index);
  }
  // remet à zéro la partie en cours (son nom et les réglages sont gardés)
  function reset() { const settings = data.settings; data = blank(); data.settings = settings; save(); }

  function list() {
    return index.list.map(p => {
      const d = p.id === index.active ? data : normalize(readJSON(keyOf(p.id)));
      return { id: p.id, name: p.name, active: p.id === index.active, best: d.best, souls: d.souls, runs: d.totals.runs,
        lastPlayed: d.lastPlayed || p.created };
    });
  }
  function create(name) {
    const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    index.list.push({ id, name: cleanName(name, 'Partie ' + (index.list.length + 1)), created: Date.now() });
    const fresh = blank(); fresh.settings = Object.assign({}, data.settings);
    writeJSON(keyOf(id), fresh);
    writeJSON(PROFILES_KEY, index);
    return id;
  }
  function switchTo(id) {
    if (!index.list.some(p => p.id === id) || id === index.active) return;
    save();                                   // on range la partie en cours
    const settings = data.settings;
    index.active = id;
    data = normalize(readJSON(keyOf(id)));
    data.settings = Object.assign({}, settings);
    save();
  }
  function rename(id, name) {
    const p = index.list.find(x => x.id === id);
    if (!p) return;
    p.name = cleanName(name, p.name);
    writeJSON(PROFILES_KEY, index);
  }
  function remove(id) {
    if (index.list.length <= 1) return;       // il reste toujours au moins une partie
    try { localStorage.removeItem(keyOf(id)); } catch (e) { /* navigation privée */ }
    index.list = index.list.filter(p => p.id !== id);
    if (index.active === id) {
      const settings = data.settings;
      index.active = index.list[0].id;
      data = normalize(readJSON(keyOf(index.active)));
      data.settings = settings;
    }
    save();
  }

  setInterval(() => { if (dirty) save(); }, 4000);
  return {
    load, save, reset, list, create, switchTo, rename, remove,
    get d() { return data; },
    get activeName() { const p = index.list.find(x => x.id === index.active); return p ? p.name : 'Ma partie'; },
    get count() { return index.list.length; },
    addSouls(n) { data.souls += n; data.totals.souls += n; dirty = true; },
    markDirty() { dirty = true; },
  };
})();

const UI = (() => {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const nf = n => Math.floor(n).toLocaleString('fr-FR');

  let screen = 'menu';
  let treeCls = 'samurai';
  let selected = null;
  let view = { x: 0, y: 0, s: 1 };
  const UX = 132, UY = 128, PAD = 90;

  function setScreen(name) {
    screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === 'scr-' + name));
    document.body.classList.toggle('in-game', name === 'game' || name === 'pause');
    $('#touch').classList.toggle('show', name === 'game' && Game.touchMode);
    if (name === 'menu') renderMenu();
    if (name === 'tree') renderTree(true);
    if (name === 'coop') { sendHello(); renderCoop(); }
    if (name === 'saves') renderSaves();
  }

  /* ---------------- Menu principal ---------------- */
  function renderMenu() {
    const d = Save.d;
    $('#menu-souls').textContent = nf(d.souls);
    $('#menu-profile').textContent = Save.activeName;
    for (const cls of ['samurai', 'soldier']) {
      const card = document.querySelector('.class-card[data-cls="' + cls + '"]');
      card.classList.toggle('sel', d.cls === cls);
      card.querySelector('.best').textContent = d.best[cls] ? 'Record : vague ' + d.best[cls] : 'Jamais joué';
      const spent = spentSouls(cls);
      card.querySelector('.spent').textContent = nf(spent) + ' âmes investies';
    }
    // départ
    const sel = $('#start-wave');
    sel.innerHTML = '';
    const best = d.best[d.cls] || 0;
    const opts = [1];
    for (let w = 5; w <= best; w += 5) opts.push(w);
    for (const w of opts) {
      const o = el('option'); o.value = w; o.textContent = 'Vague ' + w; sel.appendChild(o);
    }
    sel.value = opts[opts.length - 1] > 1 && d.lastStart && opts.includes(d.lastStart) ? d.lastStart : 1;
    $('#start-row').style.display = opts.length > 1 ? '' : 'none';
    $('#totals').textContent = d.totals.runs ? d.totals.runs + ' parties · ' + nf(d.totals.kills) + ' zombies abattus' : '';
    // indice : peut-on acheter quelque chose ?
    $('#btn-tree').classList.toggle('glow', canBuyAny(d.cls));
  }

  function spentSouls(cls) {
    const lv = Save.d.levels[cls];
    let tot = 0;
    for (const n of TREES[cls].nodes) for (let l = 0; l < (lv[n.id] || 0); l++) tot += nodeCost(n, l);
    return tot;
  }

  function canBuyAny(cls) {
    const lv = Save.d.levels[cls];
    return TREES[cls].nodes.some(n => nodeState(cls, n, lv) === 'buy');
  }

  /* ---------------- Parties enregistrées ---------------- */
  function openSaves(from) {
    $('#scr-saves').dataset.from = from || 'menu';
    setScreen('saves');
  }
  function renderSaves() {
    const box = $('#saves-list');
    box.innerHTML = '';
    const items = Save.list().sort((a, b) => (b.active - a.active) || (b.lastPlayed - a.lastPlayed));
    for (const p of items) {
      const best = [p.best.samurai ? 'Rōnin vague ' + p.best.samurai : '', p.best.soldier ? 'Soldat vague ' + p.best.soldier : ''].filter(Boolean).join(' · ') || 'Jamais jouée';
      const when = p.lastPlayed ? new Date(p.lastPlayed).toLocaleDateString('fr-FR') : '';
      const it = el('div', 'save-item' + (p.active ? ' active' : ''));
      const main = el('div', 'si-main');
      const name = el('div', 'si-name'); name.textContent = p.name;
      if (p.active) name.appendChild(el('span', 'si-badge', 'EN COURS'));
      const meta = el('div', 'si-meta');
      meta.textContent = best + ' · 👻 ' + nf(p.souls) + ' âmes' + (when ? ' · jouée le ' + when : '');
      main.append(name, meta);
      const btns = el('div', 'si-btns');
      if (!p.active) {
        const b = el('button', 'btn small primary', 'Choisir');
        b.onclick = () => { Sfx.init(); Sfx.click(); Save.switchTo(p.id); applySettings(); renderSaves(); };
        btns.appendChild(b);
      }
      const rn = el('button', 'btn small', 'Renommer');
      rn.onclick = () => { const v = prompt('Nouveau nom de la partie :', p.name); if (v !== null) { Save.rename(p.id, v); renderSaves(); } };
      btns.appendChild(rn);
      if (Save.count > 1) {
        const del = el('button', 'btn small ghost danger', 'Supprimer');
        del.onclick = () => {
          if (!confirm('Supprimer la partie « ' + p.name + ' » ? Ses âmes, arbres et records seront perdus (une copie de secours est gardée un moment).')) return;
          Save.remove(p.id); applySettings(); renderSaves();
        };
        btns.appendChild(del);
      }
      it.append(main, btns);
      box.appendChild(it);
    }
  }
  function createSave() {
    const input = $('#save-new-name');
    const id = Save.create(input.value);
    input.value = '';
    Save.switchTo(id);
    applySettings();
    Sfx.init(); Sfx.buy();
    renderSaves();
  }

  /* ---------------- Partie ---------------- */
  function startGame() {
    Sfx.init();
    const d = Save.d;
    const startWave = parseInt($('#start-wave').value, 10) || 1;
    d.lastStart = startWave;
    d.totals.runs++;
    Save.save();
    Game.newRun({ mode: 'solo', seed: (Math.random() * 2147483647) | 0, startWave, players: [{ cls: d.cls, levels: d.levels[d.cls] }], me: 0 });
    buildTouchButtons();
    setScreen('game');
  }

  /* ---------------- Coop en ligne ---------------- */
  const coop = { role: null, hostCls: 'samurai', peerLevels: null, peerHere: false, status: '', busy: false };
  const other = cls => cls === 'samurai' ? 'soldier' : 'samurai';
  const myCoopCls = () => coop.role === 'guest' ? other(coop.hostCls) : coop.hostCls;

  function coopStatus(msg) { coop.status = msg || ''; if (screen === 'coop') renderCoop(); }

  function renderCoop() {
    const inRoom = !!coop.role;
    $('#coop-profile').textContent = Save.activeName;
    $('#coop-idle').hidden = inRoom;
    $('#coop-room').hidden = !inRoom;
    $('#btn-coop-host').disabled = coop.busy;
    $('#btn-coop-join').disabled = coop.busy;
    $('#coop-status').textContent = coop.status;
    $('#btn-coop-back').textContent = inRoom ? 'Quitter le salon' : '← Retour';
    if (!inRoom) return;
    const mine = myCoopCls();
    $('#coop-code-show').textContent = Net.code || '';
    $('#coop-roles').innerHTML =
      '<div class="role me"><div class="portrait ' + mine + '"></div><b>Vous</b><span>' + CLASSES[mine].name + '</span></div>' +
      '<div class="role ' + (coop.peerHere ? '' : 'wait') + '"><div class="portrait ' + other(mine) + '"></div><b>Coéquipier</b><span>' +
      (coop.peerHere ? CLASSES[other(mine)].name : 'en attente…') + '</span></div>';
    const isHost = coop.role === 'host';
    $('#coop-host-ctl').hidden = !isHost;
    $('#coop-share').hidden = !isHost;
    if (isHost) {
      $('#btn-coop-start').disabled = !coop.peerHere;
      const sel = $('#coop-wave'), cur = sel.value;
      sel.innerHTML = '';
      const best = Save.d.best[coop.hostCls] || 0;
      for (const w of [1].concat(Array.from({ length: Math.floor(best / 5) }, (_, i) => (i + 1) * 5))) {
        const o = el('option'); o.value = w; o.textContent = 'Vague ' + w; sel.appendChild(o);
      }
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    }
  }

  function sendHello() { if (coop.role === 'guest') Net.send({ t: 'hello', version: 5, levels: Save.d.levels }); }
  function sendCfg() { if (coop.role === 'host') Net.send({ t: 'cfg', version: 5, hostCls: coop.hostCls }); }

  function coopHost() {
    Sfx.init();
    coop.busy = true; coopStatus('Création du salon…');
    Net.host().then(() => {
      coop.busy = false; coop.role = 'host'; coop.hostCls = Save.d.cls; coop.peerHere = false;
      coopStatus('Donnez ce code à votre coéquipier, puis attendez qu\'il vous rejoigne.');
    }).catch(e => { coop.busy = false; coop.role = null; coopStatus(e.message); });
  }

  function coopJoin(code) {
    Sfx.init();
    coop.busy = true; coopStatus('Connexion…');
    Net.join(code).then(() => {
      coop.busy = false; coop.role = 'guest'; coop.peerHere = true;
      sendHello();
      coopStatus('Connecté ! L\'hôte choisit les rôles et lance la partie.');
    }).catch(e => { coop.busy = false; coop.role = null; coopStatus(e.message); });
  }

  function coopLeave() {
    Net.close();
    coop.role = null; coop.peerHere = false; coop.peerLevels = null; coop.status = '';
  }

  function coopStart() {
    if (coop.role !== 'host' || !coop.peerHere) return;
    const cfg = {
      t: 'start', version: 5, seed: (Math.random() * 2147483647) | 0, startWave: parseInt($('#coop-wave').value, 10) || 1,
      players: [
        { cls: coop.hostCls, levels: Save.d.levels[coop.hostCls] },
        { cls: other(coop.hostCls), levels: (coop.peerLevels || {})[other(coop.hostCls)] || {} },
      ],
    };
    Net.send(cfg);
    runCoop('host', cfg, 0);
  }

  function runCoop(mode, cfg, meIdx) {
    Sfx.init();
    if (Game.R) Game.quitRun();
    Save.d.totals.runs++;
    Save.save();
    Game.newRun({ mode, seed: cfg.seed, startWave: cfg.startWave, players: cfg.players, me: meIdx });
    buildTouchButtons();
    setScreen('game');
  }

  function bindNet() {
    Net.handlers = {
      onOpen: () => {
        if (Net.role !== 'host') return;
        coop.peerHere = false; sendCfg();
        coopStatus('Vérification de la version du coéquipier…');
        Sfx.crate();
      },
      onData: m => {
        if (!m || typeof m !== 'object') return;
        if ((m.t === 'hello' || m.t === 'cfg' || m.t === 'start') && m.version !== 5) {
          coop.peerHere = false;
          coopStatus('Versions différentes : actualisez le jeu sur les deux appareils, puis recréez le salon.');
          if (screen === 'coop') renderCoop();
          return;
        }
        if (m.t === 'hello' && coop.role === 'host') { coop.peerLevels = m.levels || {}; coop.peerHere = true; sendCfg(); coopStatus('Coéquipier connecté. Lancez quand vous êtes prêts !'); if (screen === 'coop') renderCoop(); }
        else if (m.t === 'cfg' && coop.role === 'guest') { coop.hostCls = m.hostCls === 'soldier' ? 'soldier' : 'samurai'; if (screen === 'coop') renderCoop(); }
        else if (m.t === 'start' && coop.role === 'guest') runCoop('guest', m, 1);
        else Game.netMessage(m);
      },
      onClose: () => {
        coop.peerHere = false;
        Game.peerLeft();
        if (coop.role === 'guest') { coopLeave(); coopStatus('Connexion avec l\'hôte perdue.'); }
        else if (coop.role === 'host') coopStatus('Votre coéquipier s\'est déconnecté. Le salon reste ouvert avec le même code.');
      },
    };
  }

  function endGame(sum) {
    const d = Save.d;
    const isRecord = sum.wave > (d.best[sum.cls] || 0);
    d.best[sum.cls] = Math.max(d.best[sum.cls] || 0, sum.wave);
    d.totals.kills += sum.kills;
    Save.save();
    $('#over-title').textContent = 'Submergé à la vague ' + sum.wave;
    $('#over-stats').innerHTML =
      '<div><b>' + sum.wave + '</b><span>vague atteinte' + (isRecord ? ' · <em>record !</em>' : '') + '</span></div>' +
      '<div><b>' + nf(sum.kills) + '</b><span>zombies abattus' + (sum.coop ? ' (dont ' + nf(sum.myKills) + ' par vous)' : '') + '</span></div>' +
      '<div><b>' + nf(sum.souls) + '</b><span>âmes récoltées</span></div>' +
      '<div><b>' + Math.floor(sum.time / 60) + ' min ' + String(Math.floor(sum.time % 60)).padStart(2, '0') + '</b><span>de survie</span></div>' +
      '<div><b>' + (sum.level || 1) + '</b><span>niveau atteint</span></div>' +
      '<div><b>×' + nf(sum.combo || 0) + '</b><span>meilleur carnage</span></div>';
    lastCoop = !!sum.coop;
    $('#btn-over-again').textContent = lastCoop ? '👥 Retour au salon' : '↻ Rejouer';
    $('#over-souls').textContent = nf(d.souls);
    $('#over-tip').textContent = tipFor(sum);
    $('#btn-over-tree').classList.toggle('glow', canBuyAny(sum.cls));
    Game.quitRun();
    setScreen('over');
  }

  let lastCoop = false;
  function tipFor(sum) {
    const tips = sum.cls === 'samurai' ? [
      'Même les coups de sabre consomment du Ki : améliorez Réservoir de Ki, Souffle et Maîtrise pour tenir la cadence.',
      'Le labyrinthe n\'a aucun cul-de-sac : regardez la carte (Tab), le rouge indique d\'où vient la horde, et gardez toujours une sortie.',
      'Les reliques violettes valent le détour : Fureur, Nova ou Glaciation peuvent retourner une vague entière.',
      'Le dernier rang de chaque compétence coûte très cher mais offre un bond de puissance massif (comme l\'arrêt total du temps pour la Stase).',
      'Moisson de Ki rend de l\'énergie à chaque zombie tué : indispensable face aux grandes hordes.',
      'Le Pas du vent rend invulnérable pendant le bond : parfait pour franchir une brèche envahie.',
    ] : [
      'Vous commencez avec très peu de munitions lourdes : utilisez le pistolet et cherchez vite les caisses dans les ruines !',
      'Dans un couloir, la horde se tasse : le fusil à pompe, le lance-flammes et les grenades (qui passent par-dessus les murs) y font des ravages.',
      'Enchaîner les victimes sans pause fait grimper le Carnage : jusqu\'à deux fois plus d\'âmes.',
      'Le dernier rang de chaque compétence demande énormément d\'âmes mais transforme radicalement son efficacité.',
      'Le Radar indique les caisses hors de l\'écran pour planifier vos déplacements dans le labyrinthe.',
      'La roulade rend invulnérable : utilisez-la pour sortir d\'une maison encerclée.',
    ];
    return '💡 ' + tips[(Math.random() * tips.length) | 0];
  }

  /* ---------------- Commandes tactiles ---------------- */
  function buildTouchButtons() {
    const box = $('#touch-btns');
    box.innerHTML = '';
    const R = Game.R;
    if (!R) return;
    const me = R.players[R.me], st = me.st;
    const defs = [];
    if (me.cls === 'samurai') {
      defs.push({ a: 'secondary', icon: '✋', name: 'Poussée' });
      if (st.dash) defs.push({ a: 'mobility', icon: '🍃', name: 'Bond' });
      if (st.stasis) defs.push({ a: 'special', icon: '⏳', name: 'Stase' });
      if (st.ult) defs.push({ a: 'ultimate', icon: '⚔️', name: 'Tempête' });
    } else {
      if (st.grenades) defs.push({ a: 'secondary', icon: '🧨', name: 'Grenade' });
      if (st.roll) defs.push({ a: 'mobility', icon: '🤸', name: 'Roulade' });
      if (st.adren) defs.push({ a: 'special', icon: '💉', name: 'Adré.' });
      if (st.turret) defs.push({ a: 'ultimate', icon: '🗼', name: 'Tourelle' });
      defs.push({ a: 'swap', icon: '🔄', name: 'Arme' });
    }
    for (const d of defs) {
      const b = el('button', 'tbtn', '<span class="ti">' + d.icon + '</span><span class="tn">' + d.name + '</span><span class="tc"></span>');
      b.dataset.a = d.a;
      const fire = e => { e.preventDefault(); e.stopPropagation(); Game.virtualPress(d.a); b.classList.add('down'); };
      b.addEventListener('touchstart', fire, { passive: false });
      b.addEventListener('touchend', () => b.classList.remove('down'));
      b.addEventListener('mousedown', fire);
      b.addEventListener('mouseup', () => b.classList.remove('down'));
      box.appendChild(b);
    }
  }

  function updateTouchButtons() {
    const R = Game.R;
    if (!R || screen !== 'game' || !Game.touchMode) return;
    const p = R.players[R.me], st = p.st;
    document.querySelectorAll('#touch-btns .tbtn').forEach(b => {
      const a = b.dataset.a;
      let ready = true, txt = '';
      if (a === 'swap') return;
      if (p.cls === 'samurai') {
        const cost = a === 'secondary' ? st.push.cost : a === 'mobility' ? st.dash.cost : a === 'special' ? st.stasis.cost : st.ult.cost;
        ready = p.energy >= cost; txt = Math.round(cost);
        if (a === 'special' && p.stasisCd > 0) { ready = false; txt = Math.ceil(p.stasisCd) + ' s'; }
        if (a === 'ultimate' && p.ultCd > 0) { ready = false; txt = Math.ceil(p.ultCd) + ' s'; }
        if (a === 'secondary' && p.pushCd > 0) ready = false;
      } else {
        if (a === 'secondary') { ready = p.grenades > 0; txt = p.grenades; }
        if (a === 'mobility') { ready = p.rollCd <= 0; txt = ready ? '' : Math.ceil(p.rollCd); }
        if (a === 'special') { ready = p.adrenCd <= 0; txt = ready ? '' : Math.ceil(p.adrenCd); }
        if (a === 'ultimate') { ready = p.turretCd <= 0; txt = ready ? '' : Math.ceil(p.turretCd); }
      }
      b.classList.toggle('off', !ready);
      b.querySelector('.tc').textContent = txt;
    });
  }

  /* ---------------- Arbre de compétences ---------------- */
  function reqMet(n, lv) {
    return !n.req || n.req.every(([id, l]) => (lv[id] || 0) >= l);
  }
  function nodeState(cls, n, lv) {
    const l = lv[n.id] || 0;
    if (l >= n.max) return 'max';
    if (!reqMet(n, lv)) return 'locked';
    return Save.d.souls >= nodeCost(n, l) ? 'buy' : 'poor';
  }

  function renderTree(recenter) {
    const T = TREES[treeCls];
    const lv = Save.d.levels[treeCls];
    $('#tree-souls').textContent = nf(Save.d.souls);
    document.querySelectorAll('.tree-tab').forEach(t => t.classList.toggle('sel', t.dataset.cls === treeCls));
    const inner = $('#tree-inner');
    inner.innerHTML = '';
    const maxX = Math.max(...T.nodes.map(n => n.x)), maxY = Math.max(...T.nodes.map(n => n.y));
    const w = maxX * UX + PAD * 2, h = maxY * UY + PAD * 2 + 30;
    inner.style.width = w + 'px'; inner.style.height = h + 'px';
    const pos = n => ({ x: PAD + n.x * UX, y: PAD + 30 + n.y * UY });
    // liens
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    for (const n of T.nodes) {
      if (!n.req) continue;
      for (const [id, l] of n.req) {
        const a = pos(T.byId[id]), b = pos(n);
        const line = document.createElementNS(svgNS, 'path');
        const my = (a.y + b.y) / 2;
        line.setAttribute('d', 'M' + a.x + ' ' + a.y + ' C' + a.x + ' ' + my + ' ' + b.x + ' ' + my + ' ' + b.x + ' ' + b.y);
        const ok = (lv[id] || 0) >= l;
        line.setAttribute('class', 'link' + (ok ? ' ok' : ''));
        svg.appendChild(line);
        if (!ok) {
          const t = document.createElementNS(svgNS, 'text');
          t.setAttribute('x', (a.x + b.x) / 2 + 4); t.setAttribute('y', my + 4);
          t.setAttribute('class', 'reqlbl');
          t.textContent = 'niv. ' + l;
          svg.appendChild(t);
        }
      }
    }
    inner.appendChild(svg);
    // titres de branches
    for (const br of T.branches) {
      const t = el('div', 'branch', br.name);
      t.style.left = (PAD + br.x * UX) + 'px'; t.style.top = (PAD - 40) + 'px';
      inner.appendChild(t);
    }
    // nœuds
    for (const n of T.nodes) {
      const p = pos(n);
      const l = lv[n.id] || 0;
      const state = nodeState(treeCls, n, lv);
      const b = el('button', 'node ' + state + (selected === n.id ? ' sel' : '') + (l > 0 ? ' owned' : ''),
        '<span class="ic">' + n.icon + '</span><span class="lv">' + l + '/' + n.max + '</span>');
      b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      b.title = n.name;
      b.dataset.id = n.id;
      const nm = el('div', 'nname', n.name);
      b.appendChild(nm);
      b.addEventListener('click', e => {
        if (drag.moved) return;
        if (e.shiftKey) { buy(n, true); return; }
        selected = n.id;
        renderTree(false);
      });
      inner.appendChild(b);
    }
    renderDetail();
    if (recenter) centerTree();
    applyView();
  }

  function renderDetail() {
    const box = $('#tree-detail');
    const T = TREES[treeCls];
    const lv = Save.d.levels[treeCls];
    if (!selected || !T.byId[selected]) {
      box.innerHTML = '<div class="hint">Touchez une compétence pour voir ses effets.<br><small>Maj + clic : acheter directement · molette : zoom · glisser : se déplacer</small></div>';
      return;
    }
    const n = T.byId[selected];
    const l = lv[n.id] || 0;
    const state = nodeState(treeCls, n, lv);
    let html = '<div class="dh"><span class="dic">' + n.icon + '</span><div><b>' + n.name + '</b><small>Niveau ' + l + ' / ' + n.max + '</small></div></div>';
    html += '<p>' + n.desc + '</p>';
    html += '<div class="fx"><span>Actuel</span>' + n.fx(l) + '</div>';
    const isUltNext = n.max > 1 && l === n.max - 1;
    if (l < n.max) html += '<div class="fx next"><span>' + (isUltNext ? '★ Rang ultime' : 'Suivant') + '</span>' + n.fx(l + 1) + '</div>';
    if (state === 'locked') {
      const miss = n.req.filter(([id, rl]) => (lv[id] || 0) < rl).map(([id, rl]) => T.byId[id].name + ' niv. ' + rl);
      html += '<div class="lock">🔒 Nécessite : ' + miss.join(', ') + '</div>';
    }
    if (l < n.max) {
      const c = nodeCost(n, l);
      html += '<button id="btn-buy" class="btn ' + (state === 'buy' ? 'primary' : '') + '" ' + (state === 'buy' ? '' : 'disabled') + '>' + (isUltNext ? '★ Rang ultime' : 'Améliorer') + ' — 👻 ' + nf(c) + '</button>';
      if (state === 'buy' && n.max - l > 1) html += '<button id="btn-buymax" class="btn small">Au maximum possible</button>';
    } else html += '<div class="maxed">★ Niveau maximum</div>';
    box.innerHTML = html;
    const bb = $('#btn-buy');
    if (bb) bb.addEventListener('click', () => buy(n, false));
    const bm = $('#btn-buymax');
    if (bm) bm.addEventListener('click', () => buy(n, true));
  }

  function buy(n, max) {
    const lv = Save.d.levels[treeCls];
    let bought = 0;
    do {
      const l = lv[n.id] || 0;
      if (l >= n.max || !reqMet(n, lv)) break;
      const c = nodeCost(n, l);
      if (Save.d.souls < c) break;
      Save.d.souls -= c;
      lv[n.id] = l + 1;
      bought++;
    } while (max);
    if (bought) {
      Sfx.init(); Sfx.buy();
      Save.save();
      selected = n.id;
      renderTree(false);
      const nodeEl = document.querySelector('.node[data-id="' + n.id + '"]');
      if (nodeEl) { nodeEl.classList.add('pop'); }
    } else { Sfx.init(); Sfx.empty(); }
  }

  function resetTree() {
    const spent = spentSouls(treeCls);
    if (!spent) return;
    if (!confirm('Réinitialiser l\'arbre de ' + CLASSES[treeCls].name + ' ? Les ' + nf(spent) + ' âmes investies seront entièrement rendues.')) return;
    Save.d.souls += spent;
    Save.d.levels[treeCls] = {};
    Save.save();
    selected = null;
    renderTree(false);
  }

  // déplacement et zoom de l'arbre
  const drag = { on: false, moved: false, sx: 0, sy: 0, vx: 0, vy: 0, pts: new Map(), pinch: null };
  function applyView() {
    $('#tree-inner').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
  }
  function centerTree() {
    const vp = $('#tree-view');
    const inner = $('#tree-inner');
    const w = parseFloat(inner.style.width), h = parseFloat(inner.style.height);
    const vw = vp.clientWidth || window.innerWidth, vh = vp.clientHeight || window.innerHeight;
    // l'arbre en haut, lisible ; le panneau de détail reste en bas
    view.s = Math.max(0.62, Math.min(1, vw / w, (vh - 170) / h));
    view.x = w * view.s < vw ? (vw - w * view.s) / 2 : 8;
    view.y = 4;
  }
  function bindTreeView() {
    const vp = $('#tree-view');
    vp.addEventListener('pointerdown', e => {
      drag.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.pts.size === 1) {
        drag.on = true; drag.moved = false;
        drag.sx = e.clientX; drag.sy = e.clientY; drag.vx = view.x; drag.vy = view.y;
      } else if (drag.pts.size === 2) {
        const [a, b] = [...drag.pts.values()];
        drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.x, vy: view.y };
        drag.moved = true;
      }
    });
    vp.addEventListener('pointermove', e => {
      if (!drag.pts.has(e.pointerId)) return;
      drag.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.pinch && drag.pts.size >= 2) {
        const [a, b] = [...drag.pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ns = Math.max(0.35, Math.min(1.6, drag.pinch.s * d / drag.pinch.d));
        const r = vp.getBoundingClientRect();
        const cx = drag.pinch.cx - r.left, cy = drag.pinch.cy - r.top;
        view.x = cx - (cx - drag.pinch.vx) * ns / drag.pinch.s;
        view.y = cy - (cy - drag.pinch.vy) * ns / drag.pinch.s;
        view.s = ns;
        applyView();
        return;
      }
      if (!drag.on) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; applyView(); }
    });
    const up = e => {
      drag.pts.delete(e.pointerId);
      if (drag.pts.size < 2) drag.pinch = null;
      if (drag.pts.size === 0) { drag.on = false; setTimeout(() => { drag.moved = false; }, 0); }
    };
    vp.addEventListener('pointerup', up);
    vp.addEventListener('click', e => {
      if (!e.target.closest('.node') && !drag.moved && selected) { selected = null; renderTree(false); }
    });
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const ns = Math.max(0.35, Math.min(1.6, view.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      view.x = cx - (cx - view.x) * ns / view.s;
      view.y = cy - (cy - view.y) * ns / view.s;
      view.s = ns;
      applyView();
    }, { passive: false });
  }

  /* ---------------- Options ---------------- */
  function openOptions(from) {
    const s = Save.d.settings;
    $('#opt-sound').checked = !s.muted;
    $('#opt-volume').value = Math.round(s.volume * 100);
    $('#opt-dmg').checked = s.dmgNumbers;
    $('#opt-shake').checked = s.shake;
    $('#opt-autoaim').checked = s.autoAim;
    $('#opt-autoatk').checked = s.autoAttack;
    $('#scr-options').dataset.from = from;
    setScreen('options');
  }
  function applySettings() {
    const s = Save.d.settings;
    Sfx.setVolume(s.volume);
    Sfx.setMuted(s.muted);
    Game.settings = { dmgNumbers: s.dmgNumbers, shake: s.shake, autoAim: s.autoAim, autoAttack: s.autoAttack };
  }
  function readOptions() {
    const s = Save.d.settings;
    s.muted = !$('#opt-sound').checked;
    s.volume = $('#opt-volume').value / 100;
    s.dmgNumbers = $('#opt-dmg').checked;
    s.shake = $('#opt-shake').checked;
    s.autoAim = $('#opt-autoaim').checked;
    s.autoAttack = $('#opt-autoatk').checked;
    applySettings();
    Save.save();
  }

  /* ---------------- Initialisation ---------------- */
  function init() {
    Save.load();
    Game.init($('#game'));
    applySettings();
    Game.hooks = {
      onSouls: n => Save.addSouls(n),
      getSouls: () => Save.d.souls,
      onWaveClear: w => {
        const d = Save.d;
        const R = Game.R;
        if (!R) return;
        const cls = R.players[R.me].cls;
        if (w > (d.best[cls] || 0)) d.best[cls] = w;
        Save.save();
      },
      onEnd: sum => endGame(sum),
      onPause: p => setScreen(p ? 'pause' : 'game'),
      onTouchMode: on => { $('#touch').classList.toggle('show', on && screen === 'game'); document.body.classList.toggle('touch', on); },
      onMute: () => { Save.d.settings.muted = !Save.d.settings.muted; applySettings(); Save.save(); },
    };

    document.querySelectorAll('.class-card').forEach(c => c.addEventListener('click', () => {
      Sfx.init(); Sfx.click();
      Save.d.cls = c.dataset.cls; Save.save(); renderMenu();
    }));
    $('#btn-play').addEventListener('click', startGame);
    $('#btn-tree').addEventListener('click', () => { Sfx.init(); treeCls = Save.d.cls; selected = null; $('#scr-tree').dataset.from = 'menu'; setScreen('tree'); });
    bindNet();
    $('#btn-coop').addEventListener('click', () => { Sfx.init(); setScreen('coop'); });
    $('#btn-coop-host').addEventListener('click', coopHost);
    $('#btn-coop-join').addEventListener('click', () => coopJoin($('#coop-code').value));
    $('#coop-code').addEventListener('keydown', e => { e.stopPropagation(); if (e.code === 'Enter') coopJoin($('#coop-code').value); });
    $('#btn-coop-swap').addEventListener('click', () => { coop.hostCls = other(coop.hostCls); sendCfg(); renderCoop(); });
    $('#btn-coop-start').addEventListener('click', coopStart);
    $('#btn-coop-copy').addEventListener('click', () => {
      const url = location.origin + location.pathname + '?join=' + Net.code;
      const done = () => { $('#btn-coop-copy').textContent = 'Lien copié ✔'; setTimeout(() => { $('#btn-coop-copy').textContent = 'Copier le lien d\'invitation'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Lien d\'invitation :', url));
      else prompt('Lien d\'invitation :', url);
    });
    $('#btn-coop-tree').addEventListener('click', () => { treeCls = coop.role ? myCoopCls() : Save.d.cls; selected = null; $('#scr-tree').dataset.from = 'coop'; setScreen('tree'); });
    $('#btn-coop-back').addEventListener('click', () => { coopLeave(); setScreen('menu'); });
    $('#btn-options').addEventListener('click', () => openOptions('menu'));
    $('#btn-profile').addEventListener('click', () => openSaves('menu'));
    $('#btn-coop-profile').addEventListener('click', () => openSaves('coop'));
    $('#btn-saves-back').addEventListener('click', () => setScreen($('#scr-saves').dataset.from === 'coop' ? 'coop' : 'menu'));
    $('#btn-save-new').addEventListener('click', createSave);
    $('#save-new-name').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') createSave(); });
    $('#btn-tree-back').addEventListener('click', () => setScreen($('#scr-tree').dataset.from || 'menu'));
    $('#btn-tree-reset').addEventListener('click', resetTree);
    $('#btn-tree-play').addEventListener('click', () => {
      if (coop.role) { setScreen('coop'); return; }
      Save.d.cls = treeCls; Save.save(); renderMenu(); startGame();
    });
    document.querySelectorAll('.tree-tab').forEach(t => t.addEventListener('click', () => { treeCls = t.dataset.cls; selected = null; renderTree(true); }));
    bindTreeView();

    $('#btn-resume').addEventListener('click', () => Game.togglePause(false));
    $('#btn-pause-options').addEventListener('click', () => openOptions('pause'));
    $('#btn-quit').addEventListener('click', () => {
      const R = Game.R;
      if (!R) return;
      // abandon : on garde les âmes, la partie compte comme terminée
      R.over = true; R.endSent = true;
      const sum = Game.summary();
      if (R.coop) coopLeave(); // quitter une partie à deux ferme la liaison
      endGame(sum);
    });
    $('#btn-touch-pause').addEventListener('click', () => Game.togglePause(true));
    $('#btn-touch-pause').addEventListener('touchstart', e => { e.preventDefault(); Game.togglePause(true); }, { passive: false });

    $('#btn-over-again').addEventListener('click', () => { if (lastCoop) setScreen('coop'); else startGame(); });
    $('#btn-over-tree').addEventListener('click', () => {
      treeCls = coop.role ? myCoopCls() : Save.d.cls; selected = null;
      $('#scr-tree').dataset.from = coop.role ? 'coop' : 'menu'; setScreen('tree');
    });
    $('#btn-over-menu').addEventListener('click', () => { coopLeave(); setScreen('menu'); });

    document.querySelectorAll('#scr-options input').forEach(i => i.addEventListener('input', readOptions));
    $('#btn-opt-back').addEventListener('click', () => {
      const from = $('#scr-options').dataset.from;
      setScreen(from === 'pause' ? 'pause' : 'menu');
    });
    $('#btn-wipe').addEventListener('click', () => {
      if (!confirm('Effacer toute la progression (âmes, arbres, records) ? C\'est définitif.')) return;
      Save.reset(); applySettings(); setScreen('menu');
    });

    window.addEventListener('keydown', e => {
      if (screen === 'menu' && (e.code === 'Enter')) startGame();
      if (screen === 'over' && e.code === 'Enter' && !lastCoop) startGame();
      if (screen === 'tree' && e.code === 'Escape') setScreen($('#scr-tree').dataset.from || 'menu');
    });

    setInterval(updateTouchButtons, 120);
    window.addEventListener('beforeunload', () => Save.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { Save.save(); if (screen === 'game' && Game.R && !Game.R.coop) Game.togglePause(true); }
    });
    setScreen('menu');
    // lien d'invitation : ?join=CODE
    const jm = /[?&]join=([A-Za-z0-9]{5})/.exec(location.search);
    if (jm) { $('#coop-code').value = jm[1].toUpperCase(); setScreen('coop'); coopJoin(jm[1]); }
  }

  return { init, setScreen, get screen() { return screen; } };
})();

window.addEventListener('DOMContentLoaded', () => {
  UI.init();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
