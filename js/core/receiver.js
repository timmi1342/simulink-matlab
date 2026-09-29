// Приёмник: запись сигнала ПЧ, тепловой шум, квантование АЦП, синхронное детектирование (раздел 2.2 ТЗ)
//
// Опорный канал R, канал прошедшей волны B и канал отражённой волны A дискретизируются
// на промежуточной частоте. Запись содержит M отсчётов и ровно k0 периодов сигнала ПЧ,
// частота дискретизации равна M · Δf, где Δf — полоса ПЧ. Комплексная амплитуда каждого
// канала выделяется ДПФ на частоте k0, измеренные S-параметры равны отношениям B/R и A/R.

import { div, mul, polar } from './complex.js';

export const KT_DBM_HZ = -174;

export function makeReceiver(sys, sources) {
  const M = sys.recordLen;
  const k0 = Math.max(2, M / 16);
  const cosT = new Float64Array(M);
  const sinT = new Float64Array(M);
  for (let n = 0; n < M; n++) {
    const th = (2 * Math.PI * k0 * n) / M;
    cosT[n] = Math.cos(th);
    sinT[n] = Math.sin(th);
  }

  const floorDbm = KT_DBM_HZ + sys.nfDb + 10 * Math.log10(sys.ifbwHz);
  const snr0Db = sys.powerDbm - floorDbm;
  const snr0 = 10 ** (snr0Db / 10);
  const sigma = sources.noise ? Math.sqrt(M / (4 * snr0)) : 0;

  const fullScale = 10 ** (sys.headroomDb / 20);
  const half = 2 ** (sys.adcBits - 1);
  const q = (2 * fullScale) / 2 ** sys.adcBits;

  return {
    M, k0, cosT, sinT, sigma, floorDbm, snr0Db,
    quant: !!sources.quant, fullScale, half, q,
    fsHz: M * sys.ifbwHz,
    ifHz: k0 * sys.ifbwHz,
  };
}

export function quantize(x, q, half) {
  let k = Math.floor(x / q + 0.5);
  if (k > half - 1) k = half - 1;
  else if (k < -half) k = -half;
  return k * q;
}

// Один канал: сигнал v · exp(jθn) в вещественной записи, шум, АЦП, ДПФ на частоте k0
function channel(rec, v, rand, cap) {
  const { M, cosT, sinT, sigma, quant, q, half } = rec;
  const c = v.re;
  const s = v.im;
  let re = 0;
  let im = 0;
  for (let n = 0; n < M; n += 2) {
    let g1 = 0;
    let g2 = 0;
    if (sigma > 0) {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const mag = sigma * Math.sqrt(-2 * Math.log(u1));
      g1 = mag * Math.cos(2 * Math.PI * u2);
      g2 = mag * Math.sin(2 * Math.PI * u2);
    }
    let x0 = c * cosT[n] - s * sinT[n] + g1;
    let x1 = c * cosT[n + 1] - s * sinT[n + 1] + g2;
    if (cap) {
      cap.x[n] = x0;
      cap.x[n + 1] = x1;
    }
    if (quant) {
      x0 = quantize(x0, q, half);
      x1 = quantize(x1, q, half);
    }
    if (cap) {
      cap.xq[n] = x0;
      cap.xq[n + 1] = x1;
    }
    re += x0 * cosT[n] + x1 * cosT[n + 1];
    im -= x0 * sinT[n] + x1 * sinT[n + 1];
  }
  return { re, im };
}

function newCapture(M) {
  return { x: new Float64Array(M), xq: new Float64Array(M) };
}

// Измерение в одной точке: s21m, s11m — отношения волн на входе приёмника без шума
export function measurePoint(rec, s21m, s11m, rand, capture = false) {
  const rot = polar(1, 2 * Math.PI * rand());
  const cap = capture ? { r: newCapture(rec.M), b: newCapture(rec.M), a: newCapture(rec.M) } : null;
  const R = channel(rec, rot, rand, cap && cap.r);
  const B = channel(rec, mul(s21m, rot), rand, cap && cap.b);
  const A = channel(rec, mul(s11m, rot), rand, cap && cap.a);
  const out = { s21: div(B, R), s11: div(A, R) };
  if (cap) {
    out.capture = cap;
    out.bins = { R, B, A };
  }
  return out;
}
