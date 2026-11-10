'use strict';
// Régressions réseau sans dépendance : node --test test-network.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function source(file) { return fs.readFileSync(path.join(__dirname, 'js', file + '.js'), 'utf8'); }
function game(mode, seed = 123, classes = ['samurai', 'soldier']) {
  const sent = [], sounds = [], clock = { now: 0 };
  const ctx = vm.createContext({
    console, ArrayBuffer, DataView, Uint8Array, performance: { now: () => clock.now },
    Sfx: new Proxy({}, { get: (_, k) => () => sounds.push(k) }),
    Net: {
      send: m => { sent.push({ reliable: true, m: structuredClone(m) }); return true; },
      sendLatest: m => { sent.push({ reliable: false, m: structuredClone(m) }); return true; },
    },
  });
  for (const f of ['data', 'world', 'engine', 'sim', 'render', 'game']) vm.runInContext(source(f), ctx, { filename: f + '.js' });
  const run = s => vm.runInContext(s, ctx);
  run(`newRun({ mode: '${mode}', seed: ${seed}, startWave: 1, me: ${mode === 'guest' ? 1 : 0}, players: ${JSON.stringify(classes.map(cls => ({ cls, levels: {} })))} });`);
  return {
    ctx, run, sent, sounds, clock,
    step() { clock.now += 1000 / 60; run('step(1 / 60)'); },
    deliver(m) { ctx.message = structuredClone(m); run('netMessage(message)'); },
  };
}

test('20 états/seconde, séquences et temps précis', () => {
  const h = game('host');
  for (let i = 0; i < 60; i++) h.step();
  const states = h.sent.filter(v => v.m.t === 's');
  assert.ok(states.length >= 20 && states.length <= 21);
  assert.ok(states.every(v => !v.reliable && v.m.run === 123));
  for (let i = 2; i < states.length; i++) assert.ok(Math.abs(states[i].m.ts - states[i - 1].m.ts - 0.05) < 1e-8);
});

test('une action fiable retardée ne rembobine pas une position plus récente', () => {
  const h = game('host');
  const x = h.run('R.players[1].x'), y = h.run('R.players[1].y');
  const d = [x, y, 0, x + 100, y, 1, 0, 1];
  h.deliver({ t: 'i', run: 123, n: 3, d });
  h.deliver({ t: 'i', run: 123, n: 2, d: [x - 20, ...d.slice(1)] });
  h.deliver({ t: 'a', run: 123, n: 1, a: 1, d: [x - 40, ...d.slice(1)], pr: ['secondary'] });
  assert.equal(h.run('R.players[1].x'), x);
  assert.equal(h.run('R.players[1].input.pressed.secondary'), true);
  h.run('R.players[1].input.pressed = {}');
  h.deliver({ t: 'a', run: 123, n: 1, a: 1, d, pr: ['secondary'] });
  assert.equal(h.run('Object.keys(R.players[1].input.pressed).length'), 0);
  for (let i = 0; i < 17; i++) h.step();
  assert.equal(h.run('R.players[1].input.attack'), false);
});

test('invité : commandes périodiques périssables, pouvoirs fiables', () => {
  const g = game('guest');
  g.run("pressed.secondary = true; mouse.left = true");
  g.step();
  assert.equal(g.sent.filter(v => v.m.t === 'a' && v.reliable).length, 1);
  assert.equal(g.sent.filter(v => v.m.t === 'i' && !v.reliable).length, 1);
  assert.equal(g.run('Object.keys(me().input.pressed).length'), 0);
  g.run('mouse.left = false');
  g.step();
  assert.equal(g.sent.at(-1).m.d[7], 0);
});

test('lissage : ordre, extrapolation bornée et téléportation', () => {
  const g = game('guest');
  g.run('globalThis.entity = { x: 0, y: 0, angle: 0 }; sampleEntity(entity, 0, 0, 0, 1); sampleEntity(entity, 10, 0, 0, 1.1); interpolateEntity(entity, 1.05)');
  assert.ok(Math.abs(g.run('entity.x') - 5) < 1e-8);
  g.run('interpolateEntity(entity, 2)');
  assert.ok(Math.abs(g.run('entity.x') - 18) < 1e-8);
  g.run('sampleEntity(entity, 500, 500, 0, 2); interpolateEntity(entity, 1.5)');
  assert.equal(g.run('entity.x'), 500);
});

test('deux simulations : 100 ms de trajet, gigue, pertes 20 %, désordre, puis reprise', () => {
  const h = game('host'), g = game('guest');
  h.run("spawnZombie('walker', me().x + 120, me().y)");
  const pending = [];
  let delivered = 0, latest = 0;
  for (let frame = 0; frame < 240; frame++) {
    h.step(); g.clock.now = h.clock.now;
    for (const v of h.sent.splice(0)) {
      if (v.m.t === 's' && v.m.n % 5 === 0) continue;
      pending.push({ at: frame + 6 + (v.m.n % 7 === 0 ? 8 : 0), ...v });
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at > frame) continue;
      const { m } = pending.splice(i, 1)[0];
      g.deliver(m);
      if (m.t === 's') { latest = Math.max(latest, m.n); delivered++; }
    }
    g.run('step(1 / 60)');
    assert.equal(g.run('R.lastSnap'), latest);
    assert.equal(g.run('R.zombies.every(z => Number.isFinite(z.x) && Number.isFinite(z.y))'), true);
  }
  assert.ok(delivered > 50);
  assert.ok(g.run('R.net.delay >= 0.075 && R.net.delay <= 0.16'));
  assert.ok(g.run('R.net.latest - R.net.clock < 0.25'));
  for (let i = 0; i < 90; i++) g.step();
  const stopped = g.run('R.zombies[0].x');
  for (let i = 0; i < 30; i++) g.step();
  assert.equal(g.run('R.zombies[0].x'), stopped);
  h.run('R.t += 2; snapT = 0; netHostTick(0)');
  g.deliver(h.sent.at(-1).m);
  assert.ok(g.run('Math.abs(R.net.latest - R.net.clock) < 0.25'));
});

test('attaque invitée immédiate sans dégâts locaux ni double son au retour', () => {
  const g = game('guest');
  g.run('mouse.left = true');
  g.step();
  assert.equal(g.sounds.filter(v => v === 'shot').length, 1);
  assert.equal(g.run('R.bullets.length'), 0);
  g.run("applyEvents([['shot', 1, 'pistol', me().x, me().y, [0, 900]]])");
  assert.equal(g.sounds.filter(v => v === 'shot').length, 1);
  assert.equal(g.run('R.bullets.length'), 1);
  assert.equal(g.run('R.kills'), 0);
  const sam = game('guest', 123, ['soldier', 'samurai']);
  sam.run('mouse.left = true'); sam.step();
  const direction = sam.run('me().swingDir');
  sam.run("applyEvents([['swing', 1, 0, 2, 0, 0.16]])");
  assert.equal(sam.run('me().swingDir'), direction);
});

test('fin fiable : les gains sont appliqués avant over malgré la perte du dernier état rapide', () => {
  const h = game('host'), g = game('guest');
  h.run('R.players[1].souls = 42; R.kills = 9; snapT = 1; gameOver(); netHostTick(0)');
  assert.deepEqual(h.sent.map(v => [v.reliable, v.m.t]), [[true, 's'], [true, 'e']]);
  for (const v of h.sent) g.deliver(v.m);
  assert.equal(g.run('R.over'), true);
  assert.equal(g.run('summary().souls'), 42);
  assert.equal(g.run('summary().kills'), 9);
});

test('nouvelle partie : remise à zéro des compteurs, rejet des messages précédents', () => {
  const h = game('host'), g = game('guest');
  h.step();
  const old = h.sent.find(v => v.m.t === 's').m;
  g.run("newRun({mode:'guest', seed:456, players:[{cls:'samurai'},{cls:'soldier'}], me:1})");
  g.deliver(old);
  g.deliver({ t: 'e', run: 123, ev: [['over']] });
  assert.equal(g.run('R.lastSnap'), 0);
  assert.equal(g.run('R.over'), false);
  assert.equal(g.run('inputN + actionN + snapN + acc'), 0);
});

test('les deux canaux peuvent se croiser sans faire régresser un niveau', () => {
  const h = game('host'), g = game('guest');
  h.run('R.level = 2; R.t = 0.123; netHostTick(0)');
  const state = h.sent.find(v => v.m.t === 's').m;
  g.run('FX.levelup(3)');
  g.deliver(state);
  assert.equal(g.run('R.level'), 3);
  assert.equal(g.run('R.t'), 0.123);
  g.run('FX.levelup(2)');
  assert.equal(g.run('R.level'), 3);
});

test('solo : simulation, pause et nouvelle partie restent fonctionnels', () => {
  const s = game('solo', 123, ['samurai']);
  for (let i = 0; i < 300; i++) s.step();
  assert.equal(s.run('R.wave'), 1);
  assert.equal(s.sent.length, 0);
  s.run('togglePause(true)');
  const time = s.run('R.t');
  s.clock.now += 100;
  s.run('advance(performance.now())');
  assert.equal(s.run('R.t'), time);
  s.run('togglePause(false)');
  s.clock.now += 100;
  s.run('advance(performance.now())');
  assert.ok(s.run('R.t') > time);
});

async function transport() {
  const clock = { now: 0 }, liveSent = [], reliable = [], incoming = [];
  let channel, connection, interval;
  class Peer extends EventEmitter {
    constructor() { super(); queueMicrotask(() => { this.open = true; this.emit('open'); }); }
    connect() {
      connection = new EventEmitter();
      Object.assign(connection, {
        open: false, bufferSize: 0, dataChannel: { bufferedAmount: 0 }, send: m => reliable.push(m),
        peerConnection: { createDataChannel(label, options) {
          channel = { label, options, readyState: 'open', bufferedAmount: 0, send: v => liveSent.push(v), close() { this.readyState = 'closed'; } };
          return channel;
        } },
      });
      queueMicrotask(() => { connection.open = true; connection.emit('open'); });
      return connection;
    }
    destroy() { connection.open = false; connection.emit('close'); }
  }
  const ctx = vm.createContext({
    console, Peer, window: { Peer }, ArrayBuffer, Uint8Array, DataView, TextEncoder, TextDecoder,
    performance: { now: () => clock.now }, setTimeout, clearTimeout,
    setInterval: f => { interval = f; return 1; }, clearInterval: () => { interval = null; },
  });
  vm.runInContext(source('net'), ctx);
  const net = vm.runInContext('Net', ctx);
  net.handlers = { onData: m => incoming.push(m) };
  await net.join('ABCDE');
  return { net, clock, liveSent, reliable, incoming, channel, connection, ping: () => interval() };
}

test('transport binaire : canal non ordonné sans retransmission, intégrité des buffers', async () => {
  const t = await transport();
  assert.equal(t.channel.options.maxRetransmits, 0);
  assert.equal(t.channel.options.ordered, false);
  assert.equal(t.channel.options.negotiated, true);
  const original = new Uint8Array([99, 1, 2, 3, 88]);
  assert.equal(t.net.sendLatest({ t: 's', n: 1, z: original.subarray(1, 4), h: new Uint8Array([8, 9]).buffer }), true);
  t.channel.onmessage({ data: t.liveSent[0] });
  assert.deepEqual([...new Uint8Array(t.incoming[0].z)], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(t.incoming[0].h)], [8, 9]);
  t.channel.onmessage({ data: new ArrayBuffer(2) });
  assert.equal(t.incoming.length, 1);
  t.net.close();
  assert.equal(t.channel.readyState, 'closed');
});

test('congestion : les états sont abandonnés sans file, les actions restent fiables, repli borné', async () => {
  const t = await transport();
  t.channel.bufferedAmount = 16 * 1024;
  for (let i = 0; i < 1000; i++) assert.equal(t.net.sendLatest({ t: 'i', n: i }), false);
  assert.equal(t.liveSent.length, 0);
  assert.equal(t.net.stats.skipped, 1000);
  t.net.send({ t: 'a', pr: ['secondary'] });
  assert.equal(t.reliable.length, 1);
  t.channel.bufferedAmount = 0;
  t.net.sendLatest({ t: 'i', n: 1001 });
  t.channel.onmessage({ data: t.liveSent[0] });
  assert.equal(t.incoming[0].n, 1001);
  t.channel.readyState = 'closed'; t.connection.bufferSize = 1;
  assert.equal(t.net.sendLatest({ t: 'i' }), false);
  t.connection.bufferSize = 0; t.connection.dataChannel.bufferedAmount = 1;
  assert.equal(t.net.sendLatest({ t: 'i' }), false);
  t.connection.dataChannel.bufferedAmount = 0;
  assert.equal(t.net.sendLatest({ t: 'i' }), true);
  t.net.close();
});

test('ping aller-retour et arrêt des statistiques à la fermeture', async () => {
  const t = await transport();
  t.clock.now = 1000; t.ping();
  t.clock.now = 1140;
  t.connection.emit('data', { t: '_pong', at: 1000 });
  assert.equal(t.net.stats.rtt, 140);
  t.clock.now = 3140;
  assert.equal(t.net.stats.silentMs, 2000);
  t.net.close();
  assert.equal(t.net.connected, false);
});
