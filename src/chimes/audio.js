// Modal synthesis of struck tubes. A free-free tube's partials sit at these
// ratios to the fundamental (a free beam's bending modes).
const RATIOS = [1, 2.756, 5.404, 8.933];
const PARTIAL_AMPS = [1, 0.55, 0.3, 0.16];
const MAX_VOICES = 24;

function impulseResponse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // One-pole lowpass that closes over time: the tail darkens like a real space.
      const k = 0.6 - 0.45 * t;
      lp += k * ((Math.random() * 2 - 1) - lp);
      data[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export function createAudio() {
  let ctx = null;
  let master, voiceBus, noiseBuf;
  let volume = 0.7;
  let finish = 'aluminium';
  const voices = [];

  function start() {
    if (ctx) return ctx.resume();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.3;
    master.connect(comp).connect(ctx.destination);

    voiceBus = ctx.createGain();
    voiceBus.connect(master);
    const verb = ctx.createConvolver();
    verb.buffer = impulseResponse(ctx, 3.5, 2.8);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    voiceBus.connect(send).connect(verb).connect(master);

    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx.resume();
  }

  function retire(v, now) {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setTargetAtTime(0, now, 0.04);
    for (const o of v.oscs) o.stop(now + 0.3);
  }

  function strike({ freq, velocity, pan = 0 }) {
    if (!ctx || ctx.state !== 'running') return;
    const hit = Math.min(1, velocity / 0.45);
    const amp = 0.2 * Math.pow(hit, 1.4);
    if (amp < 0.002) return;

    const now = ctx.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < now) voices.splice(i, 1);
    while (voices.length >= MAX_VOICES) retire(voices.shift(), now);

    const t = now + 0.004;
    const brass = finish === 'brass';
    // Lower notes ring longer; brass is a little warmer and shorter.
    const T = 2.6 * Math.sqrt(523 / freq) * (brass ? 0.8 : 1);
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner).connect(voiceBus);

    const oscs = [];
    const partial = (f, a, tau) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, tau);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + tau * 7);
      oscs.push(osc);
    };

    RATIOS.forEach((r, i) => {
      const f = freq * r;
      if (f > 15000) return;
      // Harder hits excite the upper partials more.
      const bright = i === 0 ? 1 : Math.pow(0.35 + 0.65 * hit, i) * (brass ? 0.7 : 1);
      const tau = T / Math.pow(1 + i * 1.5, 1.25);
      partial(f, amp * PARTIAL_AMPS[i] * bright, tau);
      // A slightly detuned twin gives the slow beating of a real tube.
      if (i < 2) partial(f * (1 + 0.0011 * (i + 1)), amp * PARTIAL_AMPS[i] * bright * 0.35, tau * 0.9);
    });

    // Short metallic tick at the moment of contact.
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, freq * 7);
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(amp * 0.5 * hit, t);
    ng.gain.setTargetAtTime(0, t, 0.005);
    n.connect(bp).connect(ng).connect(out);
    n.start(t);
    oscs.push(n);

    const end = t + T * 7;
    oscs[0].onended = () => out.disconnect();
    voices.push({ out, oscs, end });
  }

  return {
    start,
    strike,
    setVolume(v) {
      volume = v;
      if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },
    setFinish(f) {
      finish = f;
    },
  };
}
