'use strict';
/* HORDE — coop à distance : liaison pair-à-pair (WebRTC via PeerJS).
   Un code de 5 caractères sert de salon ; le serveur public PeerJS ne sert qu'à mettre les deux
   navigateurs en relation, les données de jeu passent ensuite directement de l'un à l'autre. */

const Net = (() => {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'horde-labyrinthe-';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let peer = null, conn = null, role = null, code = null;
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
    c.on('open', () => { conn = c; h.onOpen && h.onOpen(); });
    c.on('data', d => { h.onData && h.onData(d); });
    c.on('close', () => { if (conn === c) { conn = null; h.onClose && h.onClose(); } });
    c.on('error', () => { if (conn === c) { conn = null; h.onClose && h.onClose(); } });
  }

  function close() {
    const p = peer;
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
    if (conn && conn.open) { try { conn.send(m); } catch (e) { /* tampon plein : on saute */ } }
  }

  return {
    host, join, send, close,
    set handlers(v) { Object.assign(h, v); },
    get connected() { return !!(conn && conn.open); },
    get role() { return role; },
    get code() { return code; },
  };
})();
