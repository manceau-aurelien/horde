'use strict';
/* HORDE — coop à distance : liaison pair-à-pair (WebRTC via PeerJS).
   Un code de 5 caractères sert de salon ; le serveur public PeerJS ne sert qu'à mettre les deux
   navigateurs en relation, les données de jeu passent ensuite directement de l'un à l'autre. */

const Net = (() => {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'horde-labyrinthe-';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let peer = null, conn = null, role = null, code = null;
  let live = null, pingTimer = null, pingAt = null;
  const stats = { rtt: null, lastReceive: 0, skipped: 0 };
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const MAX_PENDING = 16 * 1024;
  const h = {}; // onOpen, onData, onClose, onError

  function loadLib() {
    return new Promise((res, rej) => {
      if (window.Peer) return res();
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => res();
      s.onerror = () => rej(new Error('Impossible de charger le module réseau (connexion Internet requise).'));
      document.head.appendChild(s);
    });
  }

  function makeCode() {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHA[(Math.random() * ALPHA.length) | 0];
    return c;
  }

  function setup(c) {
    c.on('open', () => {
      conn = c;
      stats.rtt = null; stats.skipped = 0; stats.lastReceive = performance.now();
      try {
        // Canal négocié des deux côtés : ne pas remplacer le ondatachannel de PeerJS.
        live = c.peerConnection.createDataChannel('horde-live-v3', {
          negotiated: true, id: 42, ordered: false, maxRetransmits: 0,
        });
        live.binaryType = 'arraybuffer';
        live.onmessage = e => {
          if (conn !== c) return;
          try { receive(unpack(e.data)); } catch (err) { /* paquet incomplet/invalide */ }
        };
      } catch (e) { live = null; /* repli fiable, avec limitation du tampon */ }
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (conn !== c) return;
        pingAt = performance.now();
        sendLatest({ t: '_ping', at: pingAt });
      }, 1000);
      h.onOpen && h.onOpen();
    });
    c.on('data', d => { if (conn === c) receive(d); });
    const lost = () => {
      if (conn !== c) return;
      clearLive(); conn = null;
      h.onClose && h.onClose();
    };
    c.on('close', lost);
    c.on('error', lost);
  }

  function clearLive() {
    clearInterval(pingTimer); pingTimer = null; pingAt = null;
    if (live) { live.onmessage = null; try { live.close(); } catch (e) { /* fermé */ } }
    live = null;
  }

  function receive(m) {
    if (!m || typeof m !== 'object') return;
    stats.lastReceive = performance.now();
    if (m.t === '_ping') { sendLatest({ t: '_pong', at: m.at }); return; }
    if (m.t === '_pong') {
      if (m.at === pingAt) stats.rtt = Math.round(performance.now() - m.at);
      return;
    }
    h.onData && h.onData(m);
  }

  // Métadonnées JSON + blocs binaires bruts : pas de conversion des zombies en JSON/base64.
  function bytes(v) {
    return !v ? new Uint8Array(0) : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  function pack(m) {
    const { z, h: heat, ...meta } = m, zb = bytes(z), hb = bytes(heat);
    const header = encoder.encode(JSON.stringify(meta));
    const out = new Uint8Array(8 + header.length + zb.length + hb.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, header.length); dv.setUint32(4, zb.length);
    out.set(header, 8); out.set(zb, 8 + header.length); out.set(hb, 8 + header.length + zb.length);
    return out.buffer;
  }
  function unpack(buffer) {
    const dv = new DataView(buffer), len = dv.getUint32(0), zl = dv.getUint32(4);
    if (8 + len + zl > buffer.byteLength) throw new Error('Paquet tronqué');
    const m = JSON.parse(decoder.decode(new Uint8Array(buffer, 8, len)));
    if (m.t === 's') m.z = buffer.slice(8 + len, 8 + len + zl);
    if (8 + len + zl < buffer.byteLength) m.h = buffer.slice(8 + len + zl);
    return m;
  }

  function close() {
    const p = peer;
    clearLive();
    peer = null; conn = null; role = null; code = null;
    if (p) { try { p.destroy(); } catch (e) { /* déjà fermé */ } }
  }

  async function host() {
    await loadLib();
    close();
    role = 'host';
    for (let attempt = 0; attempt < 4; attempt++) {
      const c = makeCode();
      try {
        await new Promise((res, rej) => {
          const p = new Peer(PREFIX + c);
          peer = p;
          p.on('open', () => res());
          p.on('error', e => { if (peer === p && !p.open) rej(e); else if (h.onError) h.onError(e); });
          p.on('connection', cn => {
            if (conn) { cn.on('open', () => cn.close()); return; } // salon complet
            setup(cn);
          });
          p.on('disconnected', () => { if (peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) { /* rien */ } } });
        });
        code = c;
        return c;
      } catch (e) {
        try { peer && peer.destroy(); } catch (e2) { /* rien */ }
        peer = null;
        if (!e || e.type !== 'unavailable-id') throw new Error('Serveur de mise en relation injoignable. Réessayez dans un instant.');
      }
    }
    throw new Error('Impossible de créer le salon.');
  }

  async function join(c) {
    await loadLib();
    close();
    role = 'guest';
    code = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { role = null; throw new Error('Le code comporte 5 caractères.'); }
    return new Promise((res, rej) => {
      const p = new Peer();
      peer = p;
      let done = false;
      const fail = msg => { if (done) return; done = true; close(); rej(new Error(msg)); };
      const timer = setTimeout(() => fail('Pas de réponse. Vérifiez le code, ou réessayez : certains réseaux bloquent les connexions directes.'), 20000);
      p.on('open', () => {
        const cn = p.connect(PREFIX + code, { reliable: true });
        setup(cn);
        cn.on('open', () => { if (done) return; done = true; clearTimeout(timer); res(); });
      });
      p.on('error', e => {
        clearTimeout(timer);
        fail(e && e.type === 'peer-unavailable' ? 'Aucune partie avec ce code.' : 'Connexion impossible (' + ((e && e.type) || 'erreur') + ').');
      });
    });
  }

  function send(m) {
    if (!conn || !conn.open) return false;
    try { conn.send(m); return true; } catch (e) { return false; }
  }

  function sendLatest(m) {
    if (!conn || !conn.open) return false;
    // Ne jamais empiler les anciennes positions : la prochaine remplace celle-ci.
    if (live && live.readyState === 'open') {
      const data = pack(m);
      if (live.bufferedAmount + data.byteLength > MAX_PENDING) { stats.skipped++; return false; }
      try { live.send(data); return true; } catch (e) { stats.skipped++; return false; }
    }
    if (conn.bufferSize || (conn.dataChannel && conn.dataChannel.bufferedAmount > 0)) {
      stats.skipped++; return false;
    }
    return send(m);
  }

  return {
    host, join, send, sendLatest, close,
    get stats() { return { ...stats, fast: !!(live && live.readyState === 'open'), silentMs: performance.now() - stats.lastReceive }; },
    set handlers(v) { Object.assign(h, v); },
    get connected() { return !!(conn && conn.open); },
    get role() { return role; },
    get code() { return code; },
  };
})();
