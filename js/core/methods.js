// Сравнение методов измерения разности фаз двух гармонических сигналов (раздел 2.5 ТЗ)
//
// Опорный и измерительный сигналы одной частоты складываются с белым шумом и оцифровываются.
// Каждый метод оценивает разность фаз Δφ = φизм − φоп по одной и той же записи; результат
// сравнивается с истинным значением и с нижней границей Крамера — Рао.

import { SID, stream, gaussianPair } from './rng.js';
import { quantize } from './receiver.js';

export const METHODS = [
  { key: 'dft', name: 'Цифровое синхронное детектирование (ДПФ)', short: 'ДПФ', range: '0…360°' },
  { key: 'iq', name: 'Аналоговый квадратурный демодулятор', short: 'Квадратурный демодулятор', range: '0…360°' },
  { key: 'pd', name: 'Фазовый детектор (перемножитель и ФНЧ)', short: 'Фазовый детектор', range: '0…180°' },
  { key: 'zc', name: 'Временной интервал между переходами через ноль', short: 'Переходы через ноль', range: '0…360°' },
  { key: 'sp', name: 'Шестиполюсный рефлектометр', short: 'Шестиполюсник', range: '0…360°' },
];

const TWO_PI = 2 * Math.PI;
const DEG = 180 / Math.PI;
const SIX_PORT = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];

const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));

export function wrapPi(x) {
  return x - TWO_PI * Math.floor((x + Math.PI) / TWO_PI);
}

export function makeContext(mp) {
  const M = mp.recordLen;
  const w = (TWO_PI * mp.cycles) / M;
  const c = new Float64Array(M);
  const s = new Float64Array(M);
  const win = new Float64Array(M);
  for (let n = 0; n < M; n++) {
    c[n] = Math.cos(w * n);
    s[n] = Math.sin(w * n);
    win[n] = mp.window === 'hann' ? 0.5 - 0.5 * Math.cos((TWO_PI * n) / M) : 1;
  }
  const At = 10 ** (mp.ratioDb / 20);
  const ah = mp.harmonicOn ? 10 ** (mp.harmonicDbc / 20) : 0;
  const peak = Math.max(1, At) * (1 + ah);
  const fullScale = 1.25 * peak;
  const quant = mp.adcBits < 24;
  const q = (2 * fullScale) / 2 ** mp.adcBits;
  const half = 2 ** (mp.adcBits - 1);
  const spErr = (mp.spErrDeg * Math.PI) / 180;
  return {
    M, w, c, s, win, At, ah, h: mp.harmonicOrder, quant, q, half,
    iqGain: 10 ** (mp.iqGainDb / 20),
    iqPhase: (mp.iqPhaseDeg * Math.PI) / 180,
    spTheta: [SIX_PORT[0], SIX_PORT[1] + spErr, SIX_PORT[2] - spErr],
    spComp: mp.spComp,
    xr: new Float64Array(M),
    xt: new Float64Array(M),
  };
}

// Одно испытание: формирование записей и оценки всех пяти методов, радианы
export function trial(ctx, snrDb, delta, phiR, rand) {
  const { M, w, At, ah, h, xr, xt, spTheta } = ctx;
  const sigma = Math.sqrt(1 / (2 * 10 ** (snrDb / 10)));
  const phiT = phiR + delta;
  const P = [0, 0, 0];

  for (let n = 0; n < M; n++) {
    const [g1, g2] = gaussianPair(rand);
    const [g3] = gaussianPair(rand);
    const ar = w * n + phiR;
    const at = w * n + phiT;
    const sr = Math.cos(ar) + ah * Math.cos(h * ar);
    const st = At * (Math.cos(at) + ah * Math.cos(h * at));
    const vr = sr + sigma * g1;
    const vt = st + sigma * g2;
    xr[n] = ctx.quant ? quantize(vr, ctx.q, ctx.half) : vr;
    xt[n] = ctx.quant ? quantize(vt, ctx.q, ctx.half) : vt;

    // Шестиполюсник: сумма опорной волны и измерительной, сдвинутой на θi, квадратичные детекторы
    for (let i = 0; i < 3; i++) {
      const th = spTheta[i];
      const sti = At * (Math.cos(at + th) + ah * Math.cos(h * at + h * th));
      const nti = g2 * Math.cos(th) - g3 * Math.sin(th);
      const d = vr + sti + sigma * nti;
      P[i] += d * d;
    }
  }

  return {
    dft: estDft(ctx),
    iq: estIq(ctx),
    pd: estPd(ctx),
    zc: estZc(ctx),
    sp: estSixPort(ctx, P),
  };
}

function estDft(ctx) {
  const { M, c, s, win, xr, xt } = ctx;
  let rr = 0, ri = 0, tr = 0, ti = 0;
  for (let n = 0; n < M; n++) {
    rr += win[n] * xr[n] * c[n];
    ri -= win[n] * xr[n] * s[n];
    tr += win[n] * xt[n] * c[n];
    ti -= win[n] * xt[n] * s[n];
  }
  return Math.atan2(ti * rr - tr * ri, tr * rr + ti * ri);
}

function estIq(ctx) {
  const { M, c, s, xr, xt, iqGain, iqPhase } = ctx;
  const cd = Math.cos(iqPhase);
  const sd = Math.sin(iqPhase);
  let ir = 0, qr = 0, it = 0, qt = 0;
  for (let n = 0; n < M; n++) {
    const lo = s[n] * cd + c[n] * sd;
    ir += xr[n] * c[n];
    qr -= iqGain * xr[n] * lo;
    it += xt[n] * c[n];
    qt -= iqGain * xt[n] * lo;
  }
  return wrapPi(Math.atan2(qt, it) - Math.atan2(qr, ir));
}

function estPd(ctx) {
  const { M, xr, xt } = ctx;
  let v = 0, er = 0, et = 0;
  for (let n = 0; n < M; n++) {
    v += xr[n] * xt[n];
    er += xr[n] * xr[n];
    et += xt[n] * xt[n];
  }
  const cosD = Math.max(-1, Math.min(1, v / Math.sqrt(er * et)));
  return Math.acos(cosD);
}

function crossings(x, M) {
  let mean = 0;
  for (let n = 0; n < M; n++) mean += x[n];
  mean /= M;
  const out = [];
  for (let n = 1; n < M; n++) {
    const a = x[n - 1] - mean;
    const b = x[n] - mean;
    if (a < 0 && b >= 0) out.push(n - 1 + a / (a - b));
  }
  return out;
}

function estZc(ctx) {
  const { M, w, xr, xt } = ctx;
  const cr = crossings(xr, M);
  const ct = crossings(xt, M);
  if (!cr.length || !ct.length) return 0;
  let sc = 0, ss = 0, j = 0;
  for (const tr of cr) {
    while (j + 1 < ct.length && Math.abs(ct[j + 1] - tr) <= Math.abs(ct[j] - tr)) j++;
    const d = wrapPi(w * (tr - ct[j]));
    sc += Math.cos(d);
    ss += Math.sin(d);
  }
  return Math.atan2(ss, sc);
}

function estSixPort(ctx, P) {
  let zr = 0, zi = 0;
  for (let i = 0; i < 3; i++) {
    const p = P[i] / ctx.M;
    const pm = p * (1 + ctx.spComp * p);
    zr += pm * Math.cos(SIX_PORT[i]);
    zi -= pm * Math.sin(SIX_PORT[i]);
  }
  return Math.atan2(zi, zr);
}

export function methodError(key, est, delta) {
  if (key === 'pd') return est - Math.abs(wrapPi(delta));
  return wrapPi(est - delta);
}

export function crbDeg(mp, snrDb) {
  const snr = 10 ** (snrDb / 10);
  const At = 10 ** (mp.ratioDb / 20);
  return Math.sqrt(1 / (mp.recordLen * snr) + 1 / (mp.recordLen * snr * At * At)) * DEG;
}

export async function runMethods(mp, { onProgress } = {}) {
  const ctx = makeContext(mp);
  const snrs = [];
  for (let s = mp.snrMin; s <= mp.snrMax + 1e-9; s += mp.snrStep) snrs.push(+s.toFixed(6));

  const delta = (mp.deltaDeg * Math.PI) / 180;
  const rms = {}, bias = {}, std = {};
  for (const m of METHODS) {
    rms[m.key] = new Float64Array(snrs.length);
    bias[m.key] = new Float64Array(snrs.length);
    std[m.key] = new Float64Array(snrs.length);
  }

  const deltas = [];
  for (let d = 0; d < 360; d += 5) deltas.push(d);
  const biasTrials = Math.max(10, Math.round(mp.trials / 10));
  const total = snrs.length * mp.trials + deltas.length * biasTrials;
  let done = 0;
  let lastYield = performance.now();

  const tick = async () => {
    done++;
    if (performance.now() - lastYield > 40) {
      onProgress?.(done / total);
      await yieldUI();
      lastYield = performance.now();
    }
  };

  for (let i = 0; i < snrs.length; i++) {
    const s1 = {}, s2 = {};
    for (const m of METHODS) { s1[m.key] = 0; s2[m.key] = 0; }
    for (let t = 0; t < mp.trials; t++) {
      const rand = stream(SID.methods, mp.seed, 1, i, t);
      const phiR = TWO_PI * rand();
      const est = trial(ctx, snrs[i], delta, phiR, rand);
      for (const m of METHODS) {
        const e = methodError(m.key, est[m.key], delta) * DEG;
        s1[m.key] += e;
        s2[m.key] += e * e;
      }
      await tick();
    }
    for (const m of METHODS) {
      const mean = s1[m.key] / mp.trials;
      rms[m.key][i] = Math.sqrt(s2[m.key] / mp.trials);
      bias[m.key][i] = mean;
      std[m.key][i] = Math.sqrt(Math.max(0, s2[m.key] / mp.trials - mean * mean));
    }
  }

  const biasCurve = {};
  for (const m of METHODS) biasCurve[m.key] = new Float64Array(deltas.length);
  for (let j = 0; j < deltas.length; j++) {
    const d = (deltas[j] * Math.PI) / 180;
    for (let t = 0; t < biasTrials; t++) {
      const rand = stream(SID.methods, mp.seed, 2, j, t);
      const est = trial(ctx, mp.biasSnrDb, d, 0, rand);
      for (const m of METHODS) biasCurve[m.key][j] += (methodError(m.key, est[m.key], d) * DEG) / biasTrials;
      await tick();
    }
  }
  onProgress?.(1);

  const crb = Float64Array.from(snrs, (s) => crbDeg(mp, s));
  let ti = 0;
  for (let i = 1; i < snrs.length; i++) {
    if (Math.abs(snrs[i] - mp.tableSnrDb) < Math.abs(snrs[ti] - mp.tableSnrDb)) ti = i;
  }
  const table = METHODS.map((m) => ({
    ...m,
    rms: rms[m.key][ti],
    bias: bias[m.key][ti],
    std: std[m.key][ti],
    ratio: rms[m.key][ti] / crb[ti],
    maxBias: Math.max(...Array.from(biasCurve[m.key], Math.abs)),
  }));

  return { snrs, rms, bias, std, crb, deltas, biasCurve, table, tableSnr: snrs[ti], biasTrials, biasSnr: mp.biasSnrDb };
}
