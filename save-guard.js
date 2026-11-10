/* Sauvegarde renforcée — module commun aux jeux.
 *
 * À charger AVANT les scripts du jeu, puis :
 *   SaveGuard.protect({ app: 'horde', name: 'Horde', keys: ['horde-save-v1'], prefixes: [], canReload: () => true });
 *   SaveGuard.mount(element)   // ajoute le bloc « Sauvegarde » (export / import) dans un menu
 *
 * Ce que fait le module, sans changer le code de sauvegarde du jeu :
 *  - demande au navigateur de ne pas effacer les données du site (stockage persistant) ;
 *  - un onglet resté ouvert avec une ancienne progression ne peut plus écraser une sauvegarde
 *    plus récente : il se recharge à la place ;
 *  - garde des copies de secours espacées dans le temps, et rend la dernière copie saine si la
 *    sauvegarde principale est illisible ;
 *  - export de la progression en fichier ou en code à copier, et import.
 */
(function () {
  'use strict';
  if (window.SaveGuard) return;

  const FORMAT = 'SG1:';
  const BACKUPS = 3;
  const BACKUP_GAP = 10 * 60 * 1000; // une copie de secours au plus toutes les 10 minutes
  const BACKUP_MAX = 100000;         // pas de copie pour les grosses données (images…) : le quota est partagé

  let store = null;
  try { store = window.localStorage; store.getItem('__sg.test'); } catch (e) { store = null; }

  const proto = window.Storage && Storage.prototype;
  const rawGet = proto && proto.getItem, rawSet = proto && proto.setItem, rawRemove = proto && proto.removeItem;

  let cfg = null;
  const known = {};        // révision de chaque clé connue par cet onglet
  let stale = false, unloading = false, reloadTimer = null, lastWrite = 0;
  let locked = false;      // après un import : plus aucune écriture du jeu jusqu'au rechargement

  const metaKey = k => '__sg.rev.' + k;
  const bakKey = k => '__sg.bak.' + k;
  const isMine = s => s === store;

  function isProtected(k) {
    if (!cfg || typeof k !== 'string' || k.startsWith('__sg.')) return false;
    return cfg.keys.includes(k) || cfg.prefixes.some(p => k.startsWith(p));
  }

  function readJSON(k, fallback) {
    try { const v = rawGet.call(store, k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  const revOf = k => (readJSON(metaKey(k), null) || { rev: 0 }).rev || 0;

  function validJSON(v) {
    if (v === null || v === undefined) return false;
    try { JSON.parse(v); return true; } catch (e) { return false; }
  }

  function protectedKeysInStore() {
    const out = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (isProtected(k)) out.push(k); }
    return out;
  }

  /* ---------- Copies de secours ---------- */
  function backup(k, prev, force) {
    if (!validJSON(prev) || prev.length > BACKUP_MAX) return;
    const list = readJSON(bakKey(k), []);
    const now = Date.now();
    if (!force && list.length && now - list[0].t < BACKUP_GAP) return;
    if (list.length && list[0].v === prev) return;
    list.unshift({ t: now, v: prev });
    list.length = Math.min(list.length, BACKUPS);
    try { rawSet.call(store, bakKey(k), JSON.stringify(list)); }
    catch (e) { try { rawRemove.call(store, bakKey(k)); } catch (e2) { /* plein */ } }
  }

  function bump(k) {
    const rev = revOf(k) + 1;
    known[k] = rev;
    lastWrite = Date.now();
    try { rawSet.call(store, metaKey(k), JSON.stringify({ rev, t: lastWrite })); } catch (e) { /* plein */ }
  }

  /* ---------- Onglet périmé ---------- */
  function isStale() {
    if (stale) return true;
    for (const k in known) if (revOf(k) > known[k]) return (stale = true);
    // une clé créée ailleurs après l'ouverture de cet onglet
    for (const k of protectedKeysInStore()) if (!(k in known) && revOf(k) > 0) return (stale = true);
    return false;
  }

  function scheduleReload() {
    if (reloadTimer || unloading) return;
    if (document.visibilityState !== 'visible') return;           // rechargé au retour sur l'onglet
    if (cfg.canReload && !cfg.canReload()) return;                // rechargé plus tard (ex. retour au menu)
    toast('Une progression plus récente a été enregistrée ailleurs : chargement…');
    reloadTimer = setTimeout(() => location.reload(), 1200);
  }

  function checkStale() {
    if (cfg && isStale()) scheduleReload();
  }

  /* ---------- Interception du stockage ---------- */
  function install() {
    proto.setItem = function (k, v) {
      if (!isMine(this) || !isProtected(k)) return rawSet.call(this, k, v);
      if (locked) return;
      if (isStale()) { scheduleReload(); return; }               // jamais d'écrasement par un onglet périmé
      v = String(v);
      const prev = rawGet.call(store, k);
      if (prev === v) return;
      backup(k, prev, false);
      rawSet.call(store, k, v);                                   // peut lever « stockage plein », comme avant
      bump(k);
    };
    proto.removeItem = function (k) {
      if (!isMine(this) || !isProtected(k)) return rawRemove.call(this, k);
      if (locked) return;
      if (isStale()) { scheduleReload(); return; }
      const prev = rawGet.call(store, k);
      if (prev === null) return;
      backup(k, prev, true);                                      // une remise à zéro reste récupérable
      rawRemove.call(store, k);
      bump(k);
    };
    proto.getItem = function (k) {
      const v = rawGet.call(this, k);
      if (!isMine(this) || !isProtected(k) || v === null || validJSON(v)) return v;
      // Sauvegarde illisible : on la met de côté et on rend la dernière copie saine.
      const list = readJSON(bakKey(k), []);
      const good = list.find(b => validJSON(b.v));
      if (!good) return v;
      try { rawSet.call(store, '__sg.broken.' + k, v); rawSet.call(store, k, good.v); } catch (e) { /* plein */ }
      return good.v;
    };

    window.addEventListener('storage', e => {
      if (!e.key || !(isProtected(e.key) || (e.key.startsWith('__sg.rev.') && isProtected(e.key.slice(9))))) return;
      checkStale();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkStale(); });
    window.addEventListener('pageshow', checkStale);
    window.addEventListener('focus', checkStale);
    window.addEventListener('pagehide', () => { unloading = true; });
    window.addEventListener('beforeunload', () => { unloading = true; });
    setInterval(checkStale, 3000);   // pour le rechargement différé (canReload)
  }

  /* ---------- Stockage persistant ---------- */
  let persisted = null;
  function askPersist() {
    const s = navigator.storage;
    if (!s || !s.persist) { persisted = false; return Promise.resolve(false); }
    return s.persisted()
      .then(p => p || s.persist())
      .then(p => { persisted = !!p; refreshBoxes(); return persisted; })
      .catch(() => { persisted = false; return false; });
  }

  /* ---------- Export / import ---------- */
  function payload() {
    const data = {};
    for (const k of protectedKeysInStore()) data[k] = rawGet.call(store, k);
    return { sg: 1, app: cfg.app, name: cfg.name, date: new Date().toISOString(), data };
  }
  function encode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return FORMAT + btoa(bin);
  }
  function decode(text) {
    text = String(text || '').trim();
    let obj;
    if (text.startsWith('{')) obj = JSON.parse(text);
    else {
      const b64 = text.replace(/^SG1:/, '').replace(/\s+/g, '');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      obj = JSON.parse(new TextDecoder().decode(bytes));
    }
    if (!obj || obj.sg !== 1 || !obj.data || typeof obj.data !== 'object') throw new Error('format');
    if (obj.app !== cfg.app) throw new Error('app:' + (obj.name || obj.app));
    return obj;
  }

  function applyImport(obj) {
    const keys = Object.keys(obj.data).filter(isProtected);
    if (!keys.length) throw new Error('vide');
    for (const k of protectedKeysInStore()) {
      if (keys.includes(k)) continue;
      backup(k, rawGet.call(store, k), true);
      rawRemove.call(store, k); bump(k);
    }
    for (const k of keys) {
      const v = obj.data[k];
      if (typeof v !== 'string') continue;
      backup(k, rawGet.call(store, k), true);
      rawSet.call(store, k, v); bump(k);
    }
    // le jeu garde l'ancienne progression en mémoire : il ne doit plus rien écrire avant le rechargement
    locked = true;
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  function exportFile() {
    const code = encode(payload());
    const name = cfg.app + '-sauvegarde-' + stamp() + '.txt';
    const blob = new Blob([code], { type: 'text/plain' });
    try {
      const file = new File([blob], name, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        navigator.share({ files: [file], title: 'Sauvegarde ' + cfg.name }).catch(() => {});
        return;
      }
    } catch (e) { /* partage indisponible : téléchargement classique */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Fichier de sauvegarde téléchargé.');
  }

  function copyCode() {
    const code = encode(payload());
    const done = () => toast('Code de sauvegarde copié. Collez-le dans une note pour le garder.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, () => showCode(code));
    } else showCode(code);
  }

  /* ---------- Interface ---------- */
  const CSS = `
.sg-box{margin:10px 0;padding:12px 14px;border-radius:12px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.15);text-align:left;font-size:14px;line-height:1.4}
.sg-box b{display:block;font-size:15px;margin-bottom:4px}
.sg-box .sg-st{opacity:.85;font-size:13px}
.sg-box .sg-st.warn{color:#ffc27a;opacity:1}
.sg-box .sg-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.sg-btn{font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:8px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:inherit}
.sg-btn:hover{background:rgba(255,255,255,.16)}
.sg-btn.sg-main{background:#2f6fd6;border-color:#5b93ee;color:#fff}
.sg-modal{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#eee}
.sg-card{width:min(460px,100%);background:#1c1c22;border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.sg-card h3{margin:0 0 8px;font-size:18px}
.sg-card p{margin:6px 0 10px;font-size:14px;opacity:.85}
.sg-card textarea{width:100%;box-sizing:border-box;height:110px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#111;color:#eee;font:12px/1.3 monospace;padding:8px;resize:vertical;user-select:text;-webkit-user-select:text}
.sg-card .sg-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;justify-content:flex-end}
.sg-card .sg-err{color:#ff8a8a;font-size:13px;min-height:1em;margin-top:6px}
.sg-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483001;background:rgba(20,20,26,.95);color:#fff;border:1px solid rgba(255,255,255,.25);padding:10px 16px;border-radius:10px;font:600 14px system-ui,-apple-system,"Segoe UI",sans-serif;max-width:calc(100vw - 32px);text-align:center;pointer-events:none}`;
  function injectCss() {
    if (document.getElementById('sg-css')) return;
    const s = document.createElement('style'); s.id = 'sg-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!document.body) return;
    injectCss();
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sg-toast'; }
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.remove(), 3200);
  }

  function modal(html) {
    injectCss();
    const m = document.createElement('div');
    m.className = 'sg-modal';
    m.innerHTML = '<div class="sg-card">' + html + '</div>';
    // les jeux écoutent souvent le clavier et le toucher sur la page : on isole la fenêtre
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'touchstart', 'mousedown', 'wheel']) m.addEventListener(ev, e => e.stopPropagation());
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }

  function showCode(code) {
    const m = modal('<h3>Code de sauvegarde</h3><p>Copiez ce code et gardez-le dans une note ou un message.</p><textarea readonly></textarea><div class="sg-row"><button class="sg-btn sg-main">Fermer</button></div>');
    const ta = m.querySelector('textarea'); ta.value = code; ta.focus(); ta.select();
    m.querySelector('button').onclick = () => m.remove();
  }

  function openImport() {
    const m = modal('<h3>Importer une sauvegarde</h3><p>Collez le code de sauvegarde, ou choisissez le fichier exporté. La progression actuelle sera remplacée (elle reste en copie de secours).</p>' +
      '<textarea placeholder="SG1:…"></textarea><div class="sg-err"></div>' +
      '<div class="sg-row"><button class="sg-btn" data-a="file">Choisir un fichier</button><button class="sg-btn" data-a="cancel">Annuler</button><button class="sg-btn sg-main" data-a="ok">Restaurer</button></div>' +
      '<input type="file" accept=".txt,.json,text/plain,application/json" hidden>');
    const ta = m.querySelector('textarea'), err = m.querySelector('.sg-err'), input = m.querySelector('input');
    const restore = text => {
      try {
        const obj = decode(text);
        const when = obj.date ? new Date(obj.date).toLocaleString('fr-FR') : '?';
        if (!confirm('Remplacer la progression actuelle par la sauvegarde du ' + when + ' ?')) return;
        applyImport(obj);
        m.remove();
        toast('Sauvegarde restaurée : chargement…');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        const msg = String(e.message || '');
        err.textContent = msg.startsWith('app:') ? 'Ce code appartient à un autre jeu (' + msg.slice(4) + ').' : 'Code ou fichier illisible.';
      }
    };
    m.querySelector('[data-a=file]').onclick = () => input.click();
    m.querySelector('[data-a=cancel]').onclick = () => m.remove();
    m.querySelector('[data-a=ok]').onclick = () => restore(ta.value);
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      f.text().then(t => { ta.value = t; restore(t); });
    };
    setTimeout(() => ta.focus(), 50);
  }

  const boxes = new Set();
  function ago(t) {
    if (!t) return 'aucune pour l’instant';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'il y a quelques secondes';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return 'le ' + new Date(t).toLocaleDateString('fr-FR');
  }
  function lastSaveTime() {
    let t = lastWrite;
    for (const k of protectedKeysInStore()) { const m = readJSON(metaKey(k), null); if (m && m.t > t) t = m.t; }
    return t;
  }
  function refreshBoxes() {
    for (const b of boxes) {
      if (!b.isConnected) { boxes.delete(b); continue; }
      const st = b.querySelector('.sg-st');
      const last = 'Dernière sauvegarde : ' + ago(lastSaveTime()) + '.';
      if (!store) { st.textContent = 'Le navigateur bloque l’enregistrement (navigation privée ?) : la progression sera perdue en fermant le jeu.'; st.className = 'sg-st warn'; }
      else if (persisted) { st.textContent = last + ' Stockage protégé : le navigateur ne l’effacera pas de lui-même.'; st.className = 'sg-st'; }
      else { st.textContent = last + ' Le navigateur peut effacer les données de ce site : exportez de temps en temps.'; st.className = 'sg-st warn'; }
    }
  }

  function mount(parent, before) {
    if (!cfg || !parent) return null;
    injectCss();
    const box = document.createElement('div');
    box.className = 'sg-box';
    box.innerHTML = '<b>💾 Sauvegarde</b><div class="sg-st"></div><div class="sg-row">' +
      '<button type="button" class="sg-btn" data-a="file">⬇ Exporter un fichier</button>' +
      '<button type="button" class="sg-btn" data-a="code">📋 Copier le code</button>' +
      '<button type="button" class="sg-btn" data-a="import">⬆ Importer</button></div>';
    box.querySelector('[data-a=file]').onclick = e => { e.preventDefault(); exportFile(); };
    box.querySelector('[data-a=code]').onclick = e => { e.preventDefault(); copyCode(); };
    box.querySelector('[data-a=import]').onclick = e => { e.preventDefault(); openImport(); };
    for (const ev of ['keydown', 'pointerdown', 'touchstart', 'mousedown']) box.addEventListener(ev, e => e.stopPropagation());
    if (before) parent.insertBefore(box, before); else parent.appendChild(box);
    boxes.add(box);
    refreshBoxes();
    return box;
  }
  setInterval(refreshBoxes, 2000);

  // Fenêtre « Sauvegarde » autonome, pour les jeux sans menu d'options
  function openPanel() {
    if (!cfg) return;
    const m = modal('<h3>' + cfg.name + '</h3><div class="sg-slot"></div><div class="sg-row"><button class="sg-btn sg-main">Fermer</button></div>');
    mount(m.querySelector('.sg-slot'));
    m.querySelector('.sg-main').onclick = () => m.remove();
  }

  /* ---------- Démarrage ---------- */
  function protect(options) {
    if (cfg) return;
    cfg = Object.assign({ app: 'jeu', name: 'Jeu', keys: [], prefixes: [], canReload: null }, options);
    if (!store || !proto) return;
    // révision connue au moment où l'onglet lit sa sauvegarde
    for (const k of protectedKeysInStore()) known[k] = revOf(k);
    for (const k of cfg.keys) if (!(k in known)) known[k] = revOf(k);
    install();
    askPersist();
  }

  window.SaveGuard = {
    protect, mount, openPanel, exportFile, copyCode, openImport,
    get persisted() { return persisted; },
    get stale() { return stale; },
    // pour les tests
    _encode: o => encode(o), _decode: t => decode(t), _payload: () => payload(),
  };
})();
