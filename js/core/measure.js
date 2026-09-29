// Измерение всех состояний фазовращателя в диапазоне частот и расчёт параметров (разделы 2.2, 2.3 ТЗ)

import { cx, abs, arg, div } from './complex.js';
import { SID, stream } from './rng.js';
import { designDut, trueSweep } from './dut.js';
import { makeTestSet, applyErrors, timing, pointTime } from './testset.js';
import { makeReceiver, measurePoint } from './receiver.js';

const DEG = 180 / Math.PI;

export function wrap180(x) {
  return x - 360 * Math.floor((x + 180) / 360);
}

export function linspace(a, b, n) {
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = a;
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
  return out;
}

export function sweepFreqs(sw) {
  return linspace(sw.start, sw.stop, sw.points);
}

export function nearestIndex(arr, v) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
  }
  return best;
}

export function dutParams(p, instance) {
  return { ...p.dut, coff: p.dut.coffFf * 1e-15, instance: instance ?? p.dut.instance };
}

function measureState(tset, rec, ts, idx, f, time, rand, capture = false) {
  const E = tset.at(f, time);
  const raw = applyErrors(E,
    cx(ts.s11re[idx], ts.s11im[idx]),
    cx(ts.s21re[idx], ts.s21im[idx]),
    cx(ts.s12re[idx], ts.s12im[idx]),
    cx(ts.s22re[idx], ts.s22im[idx]));
  return measurePoint(rec, raw.s21, raw.s11, rand, capture);
}

// Полный цикл измерения: все состояния на всех частотах списка freqs
export function runMeasurement(p, opts = {}) {
  const freqs = opts.freqs ?? sweepFreqs(p.sweep);
  const run = opts.run ?? 0;
  const instance = opts.instance ?? p.dut.instance;
  const sources = opts.sources ?? p.sys.sources;
  const dut = opts.dut ?? designDut(dutParams(p, instance));
  const ts = opts.trueS ?? trueSweep(dut, freqs);

  const tset = makeTestSet(p.sys, run, sources);
  const rec = makeReceiver(p.sys, sources);
  const tm = timing(p.sys, p.sweep, dut.nStates);
  const seed = p.sys.seed;

  const M = dut.nStates;
  const nf = freqs.length;
  const N = M * nf;
  const interleaved = p.sys.strategy === 'interleaved';

  const m21re = new Float64Array(N);
  const m21im = new Float64Array(N);
  const m11re = new Float64Array(N);
  const m11im = new Float64Array(N);
  const r21re = interleaved ? new Float64Array(N) : null;
  const r21im = interleaved ? new Float64Array(N) : null;

  for (let k = 0; k < M; k++) {
    for (let fi = 0; fi < nf; fi++) {
      const idx = k * nf + fi;
      const f = freqs[fi];
      const pt = measureState(tset, rec, ts, idx, f,
        pointTime(p.sys, p.sweep, tm, k, f, false),
        stream(SID.point, seed, run, instance, k, fi, 0));
      m21re[idx] = pt.s21.re;
      m21im[idx] = pt.s21.im;
      m11re[idx] = pt.s11.re;
      m11im[idx] = pt.s11.im;

      if (interleaved && k >= 2) {
        const r = measureState(tset, rec, ts, fi, f,
          pointTime(p.sys, p.sweep, tm, k, f, true),
          stream(SID.point, seed, run, instance, k, fi, 1));
        r21re[idx] = r.s21.re;
        r21im[idx] = r.s21.im;
      }
    }
  }

  return {
    freqs, dut, nStates: M, lsb: dut.lsb, trueS: ts,
    m21re, m21im, m11re, m11im, r21re, r21im,
    interleaved, timing: tm, rec, run, instance, sources, testSet: tset,
  };
}

// Повторный расчёт одной точки с сохранением записей ПЧ (для осциллограмм и спектра)
export function capturePoint(p, res, k, fi) {
  const f = res.freqs[fi];
  const tset = makeTestSet(p.sys, res.run, res.sources);
  const rec = makeReceiver(p.sys, res.sources);
  const tm = timing(p.sys, p.sweep, res.nStates);
  const out = measureState(tset, rec, res.trueS, k * res.freqs.length + fi, f,
    pointTime(p.sys, p.sweep, tm, k, f, false),
    stream(SID.point, p.sys.seed, res.run, res.instance, k, fi, 0), true);
  return { ...out, rec, f, k };
}

function vswr(g) {
  const r = Math.min(g, 0.999);
  return (1 + r) / (1 - r);
}

// Относительные фазовые сдвиги, ошибки, потери и КСВН — истинные (T) и измеренные (M)
export function relative(res) {
  const { nStates: M, lsb, freqs, trueS: ts } = res;
  const nf = freqs.length;
  const N = M * nf;
  const r = {};
  for (const key of ['phT', 'phM', 'errT', 'errM', 'ilT', 'ilM', 'vswrT', 'vswrM']) {
    r[key] = new Float64Array(N);
  }

  for (let fi = 0; fi < nf; fi++) {
    const s0t = cx(ts.s21re[fi], ts.s21im[fi]);
    const s0m = cx(res.m21re[fi], res.m21im[fi]);
    for (let k = 0; k < M; k++) {
      const idx = k * nf + fi;
      const st = cx(ts.s21re[idx], ts.s21im[idx]);
      const sm = cx(res.m21re[idx], res.m21im[idx]);
      const ideal = k * lsb;

      let ref = s0m;
      if (res.interleaved && k >= 2) ref = cx(res.r21re[idx], res.r21im[idx]);

      const eT = k === 0 ? 0 : wrap180(arg(div(s0t, st)) * DEG - ideal);
      const eM = k === 0 ? 0 : wrap180(arg(div(ref, sm)) * DEG - ideal);

      r.errT[idx] = eT;
      r.errM[idx] = eM;
      r.phT[idx] = ideal + eT;
      r.phM[idx] = ideal + eM;
      r.ilT[idx] = -20 * Math.log10(abs(st));
      r.ilM[idx] = -20 * Math.log10(abs(sm));
      r.vswrT[idx] = vswr(Math.hypot(ts.s11re[idx], ts.s11im[idx]));
      r.vswrM[idx] = vswr(Math.hypot(res.m11re[idx], res.m11im[idx]));
    }
  }
  return r;
}

// Частотные зависимости параметров для набора w = 'T' (истинные) или 'M' (измеренные)
export function freqMetrics(rel, M, nf, w) {
  const err = rel['err' + w];
  const ph = rel['ph' + w];
  const il = rel['il' + w];
  const vs = rel['vswr' + w];

  const out = {
    rms: new Float64Array(nf),
    peak: new Float64Array(nf),
    rmsAmp: new Float64Array(nf),
    ilMean: new Float64Array(nf),
    ilMax: new Float64Array(nf),
    ilMin: new Float64Array(nf),
    vswrMax: new Float64Array(nf),
    mono: new Uint8Array(nf),
  };

  for (let fi = 0; fi < nf; fi++) {
    let s2 = 0;
    let pk = 0;
    for (let k = 1; k < M; k++) {
      const e = err[k * nf + fi];
      s2 += e * e;
      pk = Math.max(pk, Math.abs(e));
    }
    out.rms[fi] = Math.sqrt(s2 / (M - 1));
    out.peak[fi] = pk;

    let sum = 0;
    let mx = -Infinity;
    let mn = Infinity;
    let vmax = 0;
    for (let k = 0; k < M; k++) {
      const v = il[k * nf + fi];
      sum += v;
      mx = Math.max(mx, v);
      mn = Math.min(mn, v);
      vmax = Math.max(vmax, vs[k * nf + fi]);
    }
    const mean = sum / M;
    let sa = 0;
    for (let k = 0; k < M; k++) {
      const d = il[k * nf + fi] - mean;
      sa += d * d;
    }
    out.rmsAmp[fi] = Math.sqrt(sa / M);
    out.ilMean[fi] = mean;
    out.ilMax[fi] = mx;
    out.ilMin[fi] = mn;
    out.vswrMax[fi] = vmax;

    let mono = 1;
    for (let k = 0; k < M - 1; k++) {
      if (ph[(k + 1) * nf + fi] - ph[k * nf + fi] <= 0) mono = 0;
    }
    out.mono[fi] = mono;
  }
  return out;
}

export function bandIndices(freqs, lo, hi) {
  const out = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= lo - 1 && freqs[i] <= hi + 1) out.push(i);
  }
  if (!out.length) out.push(nearestIndex(freqs, (lo + hi) / 2));
  return out;
}

function summarize(fm, band) {
  let rms = 0, peak = 0, amp = 0, ilMax = -Infinity, ilMin = Infinity, vswrMax = 0, mono = true;
  for (const i of band) {
    rms = Math.max(rms, fm.rms[i]);
    peak = Math.max(peak, fm.peak[i]);
    amp = Math.max(amp, fm.rmsAmp[i]);
    ilMax = Math.max(ilMax, fm.ilMax[i]);
    ilMin = Math.min(ilMin, fm.ilMin[i]);
    vswrMax = Math.max(vswrMax, fm.vswrMax[i]);
    if (!fm.mono[i]) mono = false;
  }
  return { rmsPhase: rms, peakPhase: peak, rmsAmp: amp, ilMax, ilMin, vswrMax, monotonic: mono };
}

// Полная обработка результата измерения
export function analyze(res, p) {
  const rel = relative(res);
  const M = res.nStates;
  const nf = res.freqs.length;
  const lsb = res.lsb;
  const T = freqMetrics(rel, M, nf, 'T');
  const Mm = freqMetrics(rel, M, nf, 'M');
  const band = bandIndices(res.freqs, p.sweep.bandLo, p.sweep.bandHi);

  const sumT = summarize(T, band);
  const sumM = summarize(Mm, band);

  let dMax = 0, d2 = 0, ilMax = 0, ilSum = 0, cnt = 0, rmsErr = 0;
  for (const fi of band) {
    rmsErr = Math.max(rmsErr, Math.abs(Mm.rms[fi] - T.rms[fi]));
    for (let k = 0; k < M; k++) {
      const idx = k * nf + fi;
      const d = wrap180(rel.phM[idx] - rel.phT[idx]);
      dMax = Math.max(dMax, Math.abs(d));
      d2 += d * d;
      const di = rel.ilM[idx] - rel.ilT[idx];
      ilMax = Math.max(ilMax, Math.abs(di));
      ilSum += di;
      cnt++;
    }
  }
  const acc = {
    phaseMax: dMax,
    phaseRms: Math.sqrt(d2 / cnt),
    ilMax,
    ilMean: ilSum / cnt,
    rmsMetric: rmsErr,
  };

  const ai = nearestIndex(res.freqs, p.sweep.analysisHz);
  const dnlT = new Float64Array(M - 1);
  const dnlM = new Float64Array(M - 1);
  for (let k = 0; k < M - 1; k++) {
    dnlT[k] = (rel.phT[(k + 1) * nf + ai] - rel.phT[k * nf + ai]) / lsb - 1;
    dnlM[k] = (rel.phM[(k + 1) * nf + ai] - rel.phM[k * nf + ai]) / lsb - 1;
  }

  const bits = res.dut.bits.map((bit) => {
    const code = 1 << (res.dut.nBits - 1 - bit.index);
    const idx = code * nf + ai;
    return {
      shift: bit.shift, kind: bit.kind, code,
      phT: rel.phT[idx], phM: rel.phM[idx], ilT: rel.ilT[idx], ilM: rel.ilM[idx],
    };
  });

  return { rel, T, M: Mm, band, sumT, sumM, acc, ai, dnlT, dnlM, bits };
}

export function verdictTable(an, limits) {
  const rows = [
    { key: 'rms', name: 'СКО фазовой ошибки в полосе', unit: '°', digits: 2,
      meas: an.sumM.rmsPhase, truth: an.sumT.rmsPhase, limit: limits.rmsPhaseDeg },
    { key: 'peak', name: 'Пиковая фазовая ошибка в полосе', unit: '°', digits: 2,
      meas: an.sumM.peakPhase, truth: an.sumT.peakPhase, limit: limits.peakPhaseDeg },
    { key: 'amp', name: 'СКО амплитудной ошибки в полосе', unit: 'дБ', digits: 3,
      meas: an.sumM.rmsAmp, truth: an.sumT.rmsAmp, limit: limits.rmsAmpDb },
    { key: 'il', name: 'Вносимые потери, наибольшие в полосе', unit: 'дБ', digits: 2,
      meas: an.sumM.ilMax, truth: an.sumT.ilMax, limit: limits.ilMaxDb },
    { key: 'vswr', name: 'КСВН входа, наибольший в полосе', unit: '', digits: 3,
      meas: an.sumM.vswrMax, truth: an.sumT.vswrMax, limit: limits.vswrMax },
  ];
  for (const r of rows) {
    r.cmp = '≤';
    r.pass = r.meas <= r.limit;
    r.truePass = r.truth <= r.limit;
  }
  // Монотонность приводится справочно: при пиковой ошибке больше младшего разряда
  // она нарушается неизбежно и в технических условиях на многоразрядные ФВ не нормируется
  rows.push({
    key: 'mono', name: 'Монотонность фазовой характеристики', unit: '', bool: true, info: true,
    meas: an.sumM.monotonic, truth: an.sumT.monotonic, cmp: '', limit: 'справочно',
    pass: true, truePass: true,
  });
  return rows;
}
