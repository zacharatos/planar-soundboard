// Planar Soundboard — Planar Filters: pure Web Audio graphs (no Foundry dependencies).
//
// Every filter is a composite node that can sit in a Foundry Sound's effect pipeline
// (Sound#applyEffects). Inside it is a dry path and a wet (processed) path, so a filter
// can be faded in and out smoothly by moving the dry/wet levels.

export const ALL_CHANNELS = ["music", "environment", "interface"];
const MUSIC_AMBIENT = ["music", "environment"];

// Labels and hints are in lang/*.json as Filters.<id>.Label / Filters.<id>.Hint.
export const PRESETS = {
  muffled: {
    icon: "fa-solid fa-door-closed",
    channels: MUSIC_AMBIENT, dry: 0, wet: 1, fadeIn: 900, fadeOut: 900,
    build: (ctx, o) => chain(ctx, lowpass(ctx, o.cutoff ?? 700, 0.8))
  },
  underwater: {
    icon: "fa-solid fa-water",
    channels: ALL_CHANNELS, dry: 0, wet: 1, fadeIn: 1200, fadeOut: 1200,
    build: ctx => chain(ctx, lowpass(ctx, 420, 1.4), vibrato(ctx, 0.7, 0.0025), gain(ctx, 0.85))
  },
  cavern: {
    icon: "fa-solid fa-mountain",
    channels: ALL_CHANNELS, dry: 0.85, wet: 0.6, fadeIn: 1500, fadeOut: 1500,
    build: ctx => chain(ctx, highpass(ctx, 150), convolver(ctx, 2.2, 2.6))
  },
  vastHall: {
    icon: "fa-solid fa-landmark-dome",
    channels: ALL_CHANNELS, dry: 0.6, wet: 0.85, fadeIn: 2000, fadeOut: 2000,
    build: ctx => chain(ctx, highpass(ctx, 200), convolver(ctx, 5.5, 1.8))
  },
  ethereal: {
    icon: "fa-solid fa-ghost",
    channels: MUSIC_AMBIENT, dry: 0.15, wet: 1, fadeIn: 2000, fadeOut: 2000,
    build: ctx => chain(ctx, highpass(ctx, 700), vibrato(ctx, 0.3, 0.004), convolver(ctx, 4.5, 2.2), gain(ctx, 1.4))
  },
  memory: {
    icon: "fa-solid fa-hourglass-half",
    channels: ALL_CHANNELS, dry: 0, wet: 1, fadeIn: 2500, fadeOut: 2500,
    build: ctx => {
      const head = chain(ctx, lowpass(ctx, 1600, 0.7), vibrato(ctx, 0.45, 0.004));
      const out = ctx.createGain();
      out.gain.value = 0.85;
      const direct = gain(ctx, 0.75);
      const verb = chain(ctx, convolver(ctx, 3, 2.4), gain(ctx, 0.45));
      head.output.connect(direct);
      direct.connect(out);
      head.output.connect(verb.input);
      verb.output.connect(out);
      return { input: head.input, output: out, stop: () => { head.stop(); verb.stop(); } };
    }
  },
  deafened: {
    icon: "fa-solid fa-ear-deaf",
    channels: ALL_CHANNELS, dry: 0, wet: 1, fadeIn: 120, fadeOut: 5000, hold: 4000, tinnitus: true,
    build: ctx => chain(ctx, lowpass(ctx, 220, 0.9), gain(ctx, 0.35))
  },
  sending: {
    icon: "fa-solid fa-tower-broadcast",
    channels: MUSIC_AMBIENT, dry: 0, wet: 1, fadeIn: 600, fadeOut: 600,
    build: ctx => chain(ctx, highpass(ctx, 450, 0.9), lowpass(ctx, 2800, 0.9), shaper(ctx, 14), gain(ctx, 0.35))
  }
};

/* ---------------------------------------- */
/*  Building blocks                         */
/* ---------------------------------------- */

const nativeConnect = (a, b) => AudioNode.prototype.connect.call(a, b);

function lowpass(ctx, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = freq; f.Q.value = q;
  return f;
}

function highpass(ctx, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = freq; f.Q.value = q;
  return f;
}

function gain(ctx, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Pitch wobble: a short delay line whose delay time is modulated by a slow oscillator. */
function vibrato(ctx, rate, depth) {
  const delay = ctx.createDelay(0.2);
  delay.delayTime.value = depth * 2 + 0.005;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  lfo.connect(amount);
  amount.connect(delay.delayTime);
  lfo.start();
  return { input: delay, output: delay, stop: () => { try { lfo.stop(); } catch { /* already stopped */ } } };
}

/** Soft-clipping distortion. */
function shaper(ctx, amount) {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = "2x";
  return ws;
}

const IR_CACHE = new WeakMap();

/** Reverb from a procedurally generated impulse response — no audio files needed. */
function convolver(ctx, seconds, decay) {
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, seconds, decay);
  return conv;
}

export function impulse(ctx, seconds, decay) {
  let cache = IR_CACHE.get(ctx);
  if (!cache) IR_CACHE.set(ctx, cache = new Map());
  const key = `${seconds}:${decay}`;
  if (cache.has(key)) return cache.get(key);
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  cache.set(key, buf);
  return buf;
}

/** Connect nodes / sub-graphs in series. */
function chain(ctx, ...parts) {
  const items = parts.map(p => (p instanceof AudioNode ? { input: p, output: p, stop: null } : p));
  for (let i = 0; i < items.length - 1; i++) items[i].output.connect(items[i + 1].input);
  return {
    input: items[0].input,
    output: items.at(-1).output,
    stop: () => items.forEach(it => it.stop?.())
  };
}

/* ---------------------------------------- */
/*  Composite filter node                   */
/* ---------------------------------------- */

/**
 * Create a filter node for a Sound's effect pipeline.
 * It looks like a single AudioNode: whatever connects into it reaches its input,
 * and connect()/disconnect() called on it act on its output.
 * Starts fully dry (inaudible effect); call setFilterLevel to bring it in.
 */
export function createFilterNode(ctx, presetId, opts = {}) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`Unknown filter preset "${presetId}"`);
  const input = ctx.createGain();
  const out = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0;

  const graph = preset.build(ctx, opts);
  nativeConnect(input, dry);
  dry.connect(out);
  nativeConnect(input, graph.input);
  graph.output.connect(wet);
  wet.connect(out);

  input.connect = (...args) => out.connect(...args);
  input.disconnect = (...args) => {
    try { return args.length ? out.disconnect(...args) : out.disconnect(); } catch { return undefined; }
  };
  input._ps = { presetId, preset, dry, wet, out, stop: () => graph.stop?.() };
  return input;
}

/** Move a filter node to an intensity (0 = off, 1 = full) over fadeMs. */
export function setFilterLevel(node, intensity, fadeMs = 0) {
  const { preset, dry, wet } = node._ps;
  const ctx = node.context;
  const k = Math.min(1, Math.max(0, intensity));
  const t = ctx.currentTime;
  const end = t + Math.max(0.01, fadeMs / 1000);
  for (const [param, target] of [[dry.gain, 1 + (preset.dry - 1) * k], [wet.gain, preset.wet * k]]) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(target, end);
  }
}

/** A high ringing tone that fades away — the "deafened" ear ring. Returns a stop(fadeMs) function. */
export function startTinnitus(ctx, { holdMs = 4000, fadeOutMs = 5000, level = 0.03 } = {}) {
  const g = ctx.createGain();
  g.gain.value = 0;
  const a = ctx.createOscillator(), b = ctx.createOscillator();
  a.frequency.value = 6800;
  b.frequency.value = 6830; // slight beating, sounds less synthetic
  a.connect(g); b.connect(g);
  g.connect(ctx.destination);
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.08);
  g.gain.setValueAtTime(level, t + holdMs / 1000);
  g.gain.linearRampToValueAtTime(0, t + (holdMs + fadeOutMs) / 1000);
  a.start(); b.start();
  const endAt = t + (holdMs + fadeOutMs) / 1000 + 0.1;
  a.stop(endAt); b.stop(endAt);
  return (fadeMs = 800) => {
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    try { a.stop(now + fadeMs / 1000 + 0.05); b.stop(now + fadeMs / 1000 + 0.05); } catch { /* already scheduled */ }
  };
}
