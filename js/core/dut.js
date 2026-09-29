// Модель цифрового фазовращателя: схемы разрядов, расчёт номиналов, S-параметры (раздел 2.1 ТЗ)

import { cx, ZERO, add, inv, chain, cascade, parallel, seriesZ, shuntY, tline, toS } from './complex.js';
import { SID, stream, gaussianPair } from './rng.js';

export const Z0 = 50;
export const REF_LINE_DEG = 20;
export const NP_PER_DB = Math.LN10 / 20;

export const TOPOLOGIES = {
  switched: 'Переключаемые линии',
  hplp: 'Фильтры верхних и нижних частот',
  mixed: 'Комбинированная: ФВЧ/ФНЧ и нагруженная линия',
};

export const KIND_NAMES = {
  switched: 'переключаемые линии',
  hplp: 'ФВЧ/ФНЧ',
  loaded: 'нагруженная линия',
};

// Фазовые сдвиги разрядов от старшего к младшему: 180°, 90°, 45° ...
export function bitShifts(nBits) {
  const out = [];
  for (let i = 0; i < nBits; i++) out.push(180 / 2 ** i);
  return out;
}

export function bitKind(topology, shift) {
  if (topology === 'switched') return 'switched';
  if (topology === 'hplp') return 'hplp';
  return shift >= 90 ? 'hplp' : 'loaded';
}

// Расчёт номиналов по формулам проектирования на частоте f0 с учётом разброса экземпляра
export function designDut(d) {
  const nBits = d.bits;
  const w0 = 2 * Math.PI * d.f0;
  const tol = d.tolPct / 100;

  const bits = bitShifts(nBits).map((shift, i) => {
    const rand = stream(SID.dut, d.instance, i);
    const g = [];
    for (let m = 0; m < 4; m++) g.push(...gaussianPair(rand));
    const dev = (j) => 1 + tol * g[j];

    const kind = bitKind(d.topology, shift);
    const phi = (shift * Math.PI) / 180;
    const bit = { index: i, shift, kind, ron: d.ron * dev(4), coff: d.coff * dev(5) };

    if (kind === 'switched') {
      bit.thRef = ((REF_LINE_DEG * Math.PI) / 180) * dev(0);
      bit.thDel = (((REF_LINE_DEG + shift) * Math.PI) / 180) * dev(1);
      bit.zRef = Z0 * dev(2);
      bit.zDel = Z0 * dev(3);
    } else if (kind === 'hplp') {
      const psi = phi / 2;
      bit.lpL = ((Z0 * Math.tan(psi / 2)) / w0) * dev(0);
      bit.lpC = (Math.sin(psi) / (Z0 * w0)) * dev(1);
      bit.hpC = (1 / (w0 * Z0 * Math.tan(psi / 2))) * dev(2);
      bit.hpL = (Z0 / (w0 * Math.sin(psi))) * dev(3);
    } else {
      // Нагруженная линия: конденсатор C коммутируется ключом на землю (ключ открыт — Ron,
      // закрыт — Coff). Разность проводимостей нагрузок 2ΔB задаёт фазовый сдвиг, средняя
      // проводимость поглощается укорочением линии, и звено остаётся инвертором сопротивления
      const dB = Math.tan(phi / 2) / Z0;
      const a = (2 * dB) / w0;
      const cap = (a + Math.sqrt(a * a + 4 * a * d.coff)) / 2;
      const b1 = w0 * cap;
      const b2 = d.coff > 0 ? (w0 * cap * d.coff) / (cap + d.coff) : 0;
      const zInv = Z0 * Math.cos(phi / 2);
      const th = Math.acos(((b1 + b2) / 2) * zInv);
      bit.capC = cap * dev(0);
      bit.zc = (zInv / Math.sin(th)) * dev(2);
      bit.th = th * dev(3);
    }
    return bit;
  });

  return {
    nBits,
    nStates: 1 << nBits,
    lsb: 360 / (1 << nBits),
    f0: d.f0,
    qL: d.qL,
    qC: d.qC,
    lineLossDb: d.lineLossDb,
    topology: d.topology,
    bits,
  };
}

function zInd(L, w, q) {
  return { re: (w * L) / q, im: w * L };
}

function yCap(C, w, q) {
  return { re: (w * C) / q, im: w * C };
}

// Затухание отрезка линии, Нп: потери в проводниках растут как корень из частоты
function lineAlpha(dut, theta0, f) {
  return dut.lineLossDb * (theta0 / (2 * Math.PI)) * Math.sqrt(f / dut.f0) * NP_PER_DB;
}

// Ключ: открыт — сопротивление Ron, закрыт — ёмкость Coff (через неё проходит утечка)
function switchZ(bit, w, on) {
  if (on) return { z: cx(bit.ron, 0), open: false };
  if (!(bit.coff > 0)) return { z: null, open: true };
  return { z: cx(0, -1 / (w * bit.coff)), open: false };
}

function bitPath(dut, bit, f, delay) {
  const w = 2 * Math.PI * f;
  const r = f / dut.f0;
  if (bit.kind === 'switched') {
    const th = delay ? bit.thDel : bit.thRef;
    const zc = delay ? bit.zDel : bit.zRef;
    return tline(zc, th * r, lineAlpha(dut, th, f));
  }
  if (delay) {
    const zs = zInd(bit.lpL, w, dut.qL);
    return chain(seriesZ(zs), shuntY(yCap(bit.lpC, w, dut.qC)), seriesZ(zs));
  }
  const zs = inv(yCap(bit.hpC, w, dut.qC));
  return chain(seriesZ(zs), shuntY(inv(zInd(bit.hpL, w, dut.qL))), seriesZ(zs));
}

// Матрица передачи одного разряда в состоянии on (true — разряд включён, добавочная задержка)
export function bitMatrix(dut, bit, f, on) {
  const w = 2 * Math.PI * f;
  const r = f / dut.f0;
  const sOn = switchZ(bit, w, true);
  const sOff = switchZ(bit, w, false);

  if (bit.kind === 'loaded') {
    const zC = inv(yCap(bit.capC, w, dut.qC));
    const sw = on ? sOn : sOff;
    const y = sw.open ? ZERO : inv(add(sw.z, zC));
    const line = tline(bit.zc, bit.th * r, lineAlpha(dut, bit.th, f));
    return chain(shuntY(y), line, shuntY(y));
  }

  // Разряд с двумя однополюсными переключателями на два направления: рабочий канал
  // через открытые ключи, параллельно ему — утечка через закрытые ключи второго канала
  let m = chain(seriesZ(sOn.z), bitPath(dut, bit, f, on), seriesZ(sOn.z));
  if (!sOff.open) {
    m = parallel(m, chain(seriesZ(sOff.z), bitPath(dut, bit, f, !on), seriesZ(sOff.z)));
  }
  return m;
}

export function codeBit(dut, code, i) {
  return (code >> (dut.nBits - 1 - i)) & 1;
}

export function stateMatrices(dut, f) {
  return dut.bits.map((bit) => [bitMatrix(dut, bit, f, false), bitMatrix(dut, bit, f, true)]);
}

export function stateS(dut, mats, code) {
  let m = mats[0][codeBit(dut, code, 0)];
  for (let i = 1; i < dut.nBits; i++) m = cascade(m, mats[i][codeBit(dut, code, i)]);
  return toS(m, Z0);
}

export function dutS(dut, f, code) {
  return stateS(dut, stateMatrices(dut, f), code);
}

// Истинные S-параметры всех состояний на сетке частот; индекс элемента k * nf + fi
export function trueSweep(dut, freqs) {
  const M = dut.nStates;
  const nf = freqs.length;
  const out = {};
  for (const key of ['s11', 's12', 's21', 's22']) {
    out[key + 're'] = new Float64Array(M * nf);
    out[key + 'im'] = new Float64Array(M * nf);
  }
  for (let fi = 0; fi < nf; fi++) {
    const mats = stateMatrices(dut, freqs[fi]);
    for (let k = 0; k < M; k++) {
      const s = stateS(dut, mats, k);
      const idx = k * nf + fi;
      for (const key of ['s11', 's12', 's21', 's22']) {
        out[key + 're'][idx] = s[key].re;
        out[key + 'im'][idx] = s[key].im;
      }
    }
  }
  return out;
}

// Расчётные номиналы разряда в удобных единицах (для таблицы в интерфейсе и отчёте)
export function describeBit(bit) {
  const c = (s) => s.replace('.', ',');
  const deg = (x) => c(((x * 180) / Math.PI).toFixed(1)) + '°';
  const nH = (x) => c((x * 1e9).toFixed(3)) + ' нГн';
  const pF = (x) => c((x * 1e12).toFixed(3)) + ' пФ';
  if (bit.kind === 'switched') {
    return `опорная линия ${deg(bit.thRef)}, линия задержки ${deg(bit.thDel)}, ` +
      `Zв ${c(bit.zRef.toFixed(1))} / ${c(bit.zDel.toFixed(1))} Ом`;
  }
  if (bit.kind === 'hplp') {
    return `ФНЧ: L ${nH(bit.lpL)}, C ${pF(bit.lpC)}; ФВЧ: C ${pF(bit.hpC)}, L ${nH(bit.hpL)}`;
  }
  return `нагрузка C ${pF(bit.capC)} через ключ, линия ${deg(bit.th)}, Zв ${c(bit.zc.toFixed(1))} Ом`;
}
