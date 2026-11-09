'use strict';
/* Sons synthétisés avec la Web Audio API (aucun fichier à charger). */

const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let volume = 0.6, muted = false;
  const last = {};

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function setVolume(v) { volume = v; if (master) master.gain.value = muted ? 0 : v; }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : volume; }

  // Limite les sons répétés pour ne pas saturer.
  function gate(name, minGap) {
    if (!ctx || muted) return false;
    const t = ctx.currentTime;
    if (last[name] && t - last[name] < minGap) return false;
    last[name] = t;
    return true;
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function noise(t, dur, type, f0, f1, peak, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, 0.005, peak, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  function tone(t, dur, type, f0, f1, peak) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const S = {
    slash() { if (!gate('slash', 0.05)) return; const t = ctx.currentTime; noise(t, 0.13, 'bandpass', 2400, 700, 0.35, 2); },
    whirl() { if (!gate('whirl', 0.1)) return; const t = ctx.currentTime; noise(t, 0.3, 'bandpass', 600, 3000, 0.35, 1.5); },
    hit() { if (!gate('hit', 0.04)) return; const t = ctx.currentTime; noise(t, 0.08, 'lowpass', 900, 200, 0.3); },
    push() { if (!gate('push', 0.1)) return; const t = ctx.currentTime; noise(t, 0.4, 'lowpass', 300, 1800, 0.55); tone(t, 0.3, 'sine', 120, 50, 0.35); },
    stasis() { if (!gate('stasis', 0.2)) return; const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) tone(t + i * 0.07, 0.6, 'sine', 880 * Math.pow(1.26, i), 440, 0.12); },
    dash() { if (!gate('dash', 0.1)) return; const t = ctx.currentTime; noise(t, 0.2, 'highpass', 1200, 4000, 0.25); },
    ult() { if (!gate('ult', 0.3)) return; const t = ctx.currentTime; noise(t, 0.8, 'bandpass', 400, 2600, 0.4, 3); tone(t, 0.6, 'sawtooth', 110, 220, 0.12); },
    shot() { if (!gate('shot', 0.03)) return; const t = ctx.currentTime; noise(t, 0.09, 'lowpass', 3500, 400, 0.32); tone(t, 0.05, 'square', 220, 90, 0.08); },
    rifle() { if (!gate('rifle', 0.05)) return; const t = ctx.currentTime; noise(t, 0.07, 'lowpass', 4000, 500, 0.26); },
    shotgun() { if (!gate('shotgun', 0.1)) return; const t = ctx.currentTime; noise(t, 0.25, 'lowpass', 2500, 120, 0.6); tone(t, 0.12, 'square', 120, 40, 0.15); },
    flame() { if (!gate('flame', 0.09)) return; const t = ctx.currentTime; noise(t, 0.14, 'bandpass', 500, 300, 0.18, 0.7); },
    thump() { if (!gate('thump', 0.1)) return; const t = ctx.currentTime; tone(t, 0.12, 'sine', 160, 60, 0.4); },
    boom() { if (!gate('boom', 0.06)) return; const t = ctx.currentTime; noise(t, 0.7, 'lowpass', 900, 40, 0.8); tone(t, 0.5, 'sine', 90, 30, 0.5); },
    pickup() { if (!gate('pickup', 0.06)) return; const t = ctx.currentTime; tone(t, 0.08, 'triangle', 900, 1500, 0.12); },
    crate() { if (!gate('crate', 0.1)) return; const t = ctx.currentTime; tone(t, 0.1, 'triangle', 520, 520, 0.2); tone(t + 0.08, 0.15, 'triangle', 780, 780, 0.2); },
    heal() { if (!gate('heal', 0.1)) return; const t = ctx.currentTime; tone(t, 0.25, 'sine', 500, 1000, 0.2); },
    hurt() { if (!gate('hurt', 0.15)) return; const t = ctx.currentTime; tone(t, 0.15, 'sawtooth', 200, 80, 0.2); noise(t, 0.1, 'lowpass', 600, 200, 0.25); },
    groan() { if (!gate('groan', 0.7)) return; const t = ctx.currentTime;
      const f = 70 + Math.random() * 50; tone(t, 0.7, 'sawtooth', f, f * 0.7, 0.05); },
    spit() { if (!gate('spit', 0.15)) return; const t = ctx.currentTime; noise(t, 0.15, 'bandpass', 1500, 600, 0.2, 4); },
    wave() { if (!ctx || muted) return; const t = ctx.currentTime;
      tone(t, 0.9, 'sawtooth', 110, 104, 0.12); tone(t, 0.9, 'sawtooth', 165, 156, 0.08); tone(t + 0.45, 1.2, 'sawtooth', 98, 92, 0.12); },
    clear() { if (!ctx || muted) return; const t = ctx.currentTime;
      [523, 659, 784].forEach((f, i) => tone(t + i * 0.1, 0.35, 'triangle', f, f, 0.15)); },
    death() { if (!ctx || muted) return; const t = ctx.currentTime; tone(t, 1.4, 'sawtooth', 220, 40, 0.25); noise(t, 1, 'lowpass', 800, 60, 0.4); },
    click() { if (!gate('click', 0.03)) return; const t = ctx.currentTime; tone(t, 0.05, 'square', 660, 660, 0.06); },
    buy() { if (!gate('buy', 0.05)) return; const t = ctx.currentTime; tone(t, 0.12, 'triangle', 660, 990, 0.18); tone(t + 0.06, 0.14, 'triangle', 990, 1320, 0.14); },
    empty() { if (!gate('empty', 0.25)) return; const t = ctx.currentTime; tone(t, 0.04, 'square', 1200, 1100, 0.06); },
  };

  return Object.assign({ init, setVolume, setMuted, get muted() { return muted; } }, S);
})();
