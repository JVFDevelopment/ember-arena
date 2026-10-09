// Every sound is synthesised with Web Audio: nothing to download, nothing to decode.
let ctx = null, master = null, noiseBuf = null;

export function unlockAudio() {
  if (ctx) { ctx.resume(); return; }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor(); // keeps stacked hits from clipping
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function env(node, t, a, peak, dur) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function noise({ dur = 0.2, freq = 1200, q = 1, type = "bandpass", peak = 0.5, sweep = null, attack = 0.005 }) {
  const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  env(g, t, attack, peak, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}
function tone({ freq = 220, to = null, dur = 0.3, type = "sine", peak = 0.3, attack = 0.005, delay = 0 }) {
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  env(g, t, attack, peak, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

const SOUNDS = {
  swing: () => noise({ dur: 0.18, freq: 900, sweep: 2600, q: 0.8, peak: 0.25, attack: 0.03 }),
  heavySwing: () => noise({ dur: 0.32, freq: 400, sweep: 1600, q: 0.7, peak: 0.35, attack: 0.08 }),
  hit: () => { noise({ dur: 0.12, freq: 2200, q: 2, peak: 0.5 }); tone({ freq: 140, to: 60, dur: 0.15, type: "triangle", peak: 0.5 }); },
  heavyHit: () => { noise({ dur: 0.22, freq: 1400, q: 1.5, peak: 0.7 }); tone({ freq: 110, to: 40, dur: 0.3, type: "triangle", peak: 0.8 }); },
  roll: () => noise({ dur: 0.3, freq: 300, sweep: 120, type: "lowpass", peak: 0.35, attack: 0.04 }),
  hurt: () => { tone({ freq: 220, to: 90, dur: 0.25, type: "sawtooth", peak: 0.18 }); noise({ dur: 0.15, freq: 600, peak: 0.4 }); },
  parry: () => { tone({ freq: 1320, dur: 0.6, type: "triangle", peak: 0.35 }); tone({ freq: 1980, dur: 0.45, type: "sine", peak: 0.2 }); noise({ dur: 0.08, freq: 5000, q: 3, peak: 0.6 }); },
  block: () => { tone({ freq: 520, dur: 0.18, type: "triangle", peak: 0.3 }); noise({ dur: 0.08, freq: 2500, q: 2, peak: 0.4 }); },
  kill: () => { noise({ dur: 0.4, freq: 800, sweep: 200, q: 0.8, peak: 0.35 }); tone({ freq: 330, to: 110, dur: 0.4, type: "triangle", peak: 0.2 }); },
  flask: () => { [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.35, type: "sine", peak: 0.18, delay: i * 0.08 })); },
  orb: () => tone({ freq: 660, to: 330, dur: 0.35, type: "sine", peak: 0.15 }),
  slam: () => { tone({ freq: 70, to: 30, dur: 0.6, type: "sine", peak: 0.9 }); noise({ dur: 0.5, freq: 300, type: "lowpass", peak: 0.7 }); },
  roar: () => { tone({ freq: 90, to: 55, dur: 1.4, type: "sawtooth", peak: 0.25, attack: 0.2 }); noise({ dur: 1.2, freq: 500, sweep: 200, q: 0.6, peak: 0.3, attack: 0.2 }); },
  wave: () => { tone({ freq: 196, dur: 1.6, type: "sine", peak: 0.35 }); tone({ freq: 294, dur: 1.4, type: "sine", peak: 0.18, delay: 0.05 }); },
  boon: () => { [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.5, type: "triangle", peak: 0.15, delay: i * 0.06 })); },
  death: () => { tone({ freq: 196, to: 49, dur: 2.2, type: "sawtooth", peak: 0.2, attack: 0.1 }); tone({ freq: 147, to: 37, dur: 2.4, type: "sine", peak: 0.3 }); },
};

export function sfx(name) {
  if (!ctx || ctx.state !== "running") return;
  SOUNDS[name]?.();
}
