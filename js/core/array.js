// Применение результатов: фазовые ошибки фазовращателей и диаграмма направленности ФАР (раздел 2.6 ТЗ)
//
// Каждый элемент линейной решётки питается через свой экземпляр фазовращателя (разброс
// номиналов задаётся номером экземпляра). Требуемый фазовый сдвиг реализуется выбором
// состояния: по номинальному коду либо по таблице калибровки, составленной по результатам
// измерения этого экземпляра на измерительной системе.

import { designDut, trueSweep } from './dut.js';
import { runMeasurement, relative, dutParams, wrap180 } from './measure.js';

export const TAPERS = {
  uniform: 'Равномерное',
  cospd: 'Косинус в квадрате на пьедестале',
};

export const SCENARIOS = [
  { key: 'ideal', name: 'Идеальные фазовращатели' },
  { key: 'quant', name: 'Только дискретность фазы' },
  { key: 'nominal', name: 'Выбор состояния по номиналу' },
  { key: 'calib', name: 'Выбор по таблице калибровки' },
];

const RAD = Math.PI / 180;

function mod360(x) {
  return x - 360 * Math.floor(x / 360);
}

export function taperWeights(ap) {
  const N = ap.elements;
  const out = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const x = n - (N - 1) / 2;
    out[n] = ap.taper === 'cospd' ? ap.pedestal + (1 - ap.pedestal) * Math.cos((Math.PI * x) / N) ** 2 : 1;
  }
  return out;
}

export function pattern(amp, phaseDeg, dl, angles) {
  const N = amp.length;
  const out = new Float64Array(angles.length);
  for (let i = 0; i < angles.length; i++) {
    const u = 2 * Math.PI * dl * Math.sin(angles[i] * RAD);
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const ph = u * (n - (N - 1) / 2) - phaseDeg[n] * RAD;
      re += amp[n] * Math.cos(ph);
      im += amp[n] * Math.sin(ph);
    }
    out[i] = Math.hypot(re, im);
  }
  return out;
}

export function lobeMetrics(mag, angles) {
  let pk = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[pk]) pk = i;
  let l = pk;
  while (l > 0 && mag[l - 1] <= mag[l]) l--;
  let r = pk;
  while (r < mag.length - 1 && mag[r + 1] <= mag[r]) r++;
  let side = 0;
  for (let i = 0; i < mag.length; i++) if ((i < l || i > r) && mag[i] > side) side = mag[i];
  return {
    peakIndex: pk,
    peakAngle: angles[pk],
    peak: mag[pk],
    sllDb: side > 0 ? 20 * Math.log10(side / mag[pk]) : -Infinity,
  };
}

export function runArray(p) {
  const ap = p.array;
  const f = ap.freqHz;
  const freqs = new Float64Array([f]);
  const N = ap.elements;
  const dl = (ap.spacing * f) / p.dut.f0;
  const th0 = ap.steerDeg;
  const taper = taperWeights(ap);

  const elems = [];
  for (let n = 0; n < N; n++) {
    const instance = p.dut.instance + n;
    const dut = designDut(dutParams(p, instance));
    const res = runMeasurement(p, { freqs, instance, dut, trueS: trueSweep(dut, freqs) });
    const rel = relative(res);
    elems.push({ instance, phT: rel.phT, phM: rel.phM, ilT: rel.ilT });
  }
  const M = 1 << p.dut.bits;
  const lsb = 360 / M;

  let gSum = 0;
  for (const e of elems) for (let k = 0; k < M; k++) gSum += 10 ** (-e.ilT[k] / 20);
  const g = gSum / (N * M);

  const sc = {};
  for (const s of SCENARIOS) sc[s.key] = { amp: new Float64Array(N), phase: new Float64Array(N), code: new Int32Array(N) };
  const req = new Float64Array(N);
  const idealCal = new Float64Array(N);

  for (let n = 0; n < N; n++) {
    const x = n - (N - 1) / 2;
    req[n] = mod360(360 * dl * x * Math.sin(th0 * RAD));
    const e = elems[n];
    const kq = Math.round(req[n] / lsb) % M;

    let kc = 0, kt = 0;
    for (let k = 1; k < M; k++) {
      if (Math.abs(wrap180(e.phM[k] - req[n])) < Math.abs(wrap180(e.phM[kc] - req[n]))) kc = k;
      if (Math.abs(wrap180(e.phT[k] - req[n])) < Math.abs(wrap180(e.phT[kt] - req[n]))) kt = k;
    }
    idealCal[n] = wrap180(e.phT[kt] - req[n]);

    sc.ideal.amp[n] = taper[n];
    sc.ideal.phase[n] = req[n];
    sc.quant.amp[n] = taper[n];
    sc.quant.phase[n] = kq * lsb;
    sc.quant.code[n] = kq;
    sc.nominal.amp[n] = (taper[n] * 10 ** (-e.ilT[kq] / 20)) / g;
    sc.nominal.phase[n] = e.phT[kq];
    sc.nominal.code[n] = kq;
    sc.calib.amp[n] = (taper[n] * 10 ** (-e.ilT[kc] / 20)) / g;
    sc.calib.phase[n] = e.phT[kc];
    sc.calib.code[n] = kc;
  }

  const angles = new Float64Array(1801);
  for (let i = 0; i < angles.length; i++) angles[i] = -90 + i * 0.1;

  let ref = 0;
  for (let n = 0; n < N; n++) ref += taper[n];

  const out = { angles, dl, req, lsb, elems, idealCalErr: idealCal, scenarios: {} };
  for (const s of SCENARIOS) {
    const d = sc[s.key];
    const mag = pattern(d.amp, d.phase, dl, angles);
    const lm = lobeMetrics(mag, angles);
    const errs = new Float64Array(N);
    let e2 = 0, a2 = 0, aMean = 0;
    for (let n = 0; n < N; n++) {
      errs[n] = wrap180(d.phase[n] - req[n]);
      e2 += errs[n] * errs[n];
      aMean += d.amp[n] / taper[n];
    }
    aMean /= N;
    for (let n = 0; n < N; n++) a2 += (20 * Math.log10(d.amp[n] / taper[n] / aMean)) ** 2;
    const db = Float64Array.from(mag, (v) => 20 * Math.log10(Math.max(v / ref, 1e-6)));
    out.scenarios[s.key] = {
      ...s,
      ...d,
      errs,
      db,
      peakAngle: lm.peakAngle,
      pointErr: lm.peakAngle - th0,
      gainDb: 20 * Math.log10(lm.peak / ref),
      sllDb: lm.sllDb,
      rmsPhase: Math.sqrt(e2 / N),
      rmsAmpDb: Math.sqrt(a2 / N),
    };
  }
  let ic2 = 0;
  for (const v of idealCal) ic2 += v * v;
  out.idealCalRms = Math.sqrt(ic2 / N);
  return out;
}
