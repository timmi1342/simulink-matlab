// Представление результатов: состав графиков каждой вкладки и заполнение таблиц (разделы 2.8, 3 ТЗ)

import { fmt, fmtTrim, seqColor, palette } from './chart.js';
import { lineChart, barChart, polarChart, heatmap, histogram, hbarChart } from './plots.js';
import { KIND_NAMES, describeBit } from '../core/dut.js';
import { wrap180 } from '../core/measure.js';
import { METHODS } from '../core/methods.js';
import { SCENARIOS } from '../core/array.js';

const GHz = (f) => f / 1e9;
const ghzArr = (a) => Float64Array.from(a, GHz);
const fGHz = (f) => `${fmt(GHz(f), 3)} ГГц`;

export const PLOTS = {
  stand: [
    { key: 'polar', label: 'Полярная диаграмма', file: 'polyarnaya_diagramma', cls: 'tall' },
    { key: 'phase', label: 'Фаза от частоты', file: 'faza_ot_chastoty', cls: 'tall' },
    { key: 'errStates', label: 'Ошибка по состояниям', file: 'oshibka_po_sostoyaniyam' },
    { key: 'rms', label: 'СКО ошибки от частоты', file: 'sko_ot_chastoty' },
    { key: 'heat', label: 'Тепловая карта', file: 'teplovaya_karta' },
    { key: 'accuracy', label: 'Погрешность измерения', file: 'pogreshnost_izmereniya' },
    { key: 'il', label: 'Вносимые потери', file: 'vnosimye_poteri' },
    { key: 'vswr', label: 'КСВН', file: 'ksvn' },
    { key: 'dnl', label: 'Дифференциальная нелинейность', file: 'dnl' },
    { key: 'scope', label: 'Запись ПЧ', file: 'zapis_pch' },
    { key: 'spectrum', label: 'Спектр записи ПЧ', file: 'spektr_pch' },
  ],
  mc: [
    { key: 'hist', label: 'Гистограмма', file: 'mk_gistogramma' },
    { key: 'budget', label: 'Вклад источников в u(φ)', file: 'mk_byudzhet_fazy' },
    { key: 'perState', label: 'Неопределённость по состояниям', file: 'mk_po_sostoyaniyam' },
    { key: 'budgetIl', label: 'Вклад источников в u(потерь)', file: 'mk_byudzhet_poter' },
  ],
  methods: [
    { key: 'sigma', label: 'Погрешность от ОСШ', file: 'metody_sko_ot_osh', cls: 'wide tall' },
    { key: 'bias', label: 'Смещение от разности фаз', file: 'metody_smeshchenie', cls: 'wide' },
  ],
  array: [
    { key: 'pattern', label: 'Диаграмма направленности', file: 'far_dn', cls: 'wide tall' },
    { key: 'beam', label: 'Главный лепесток', file: 'far_glavnyy_lepestok' },
    { key: 'elements', label: 'Фазовые ошибки элементов', file: 'far_oshibki_elementov' },
  ],
};

function stateSlice(arr, k, nf) {
  return arr.subarray(k * nf, (k + 1) * nf);
}

// ---------- Вкладка «Измерительный стенд» ----------

export function standDraw(key, S) {
  const { p, res, an, cap } = S;
  const nf = res.freqs.length;
  const M = res.nStates;
  const rel = an.rel;
  const x = ghzArr(res.freqs);
  const band = [GHz(p.sweep.bandLo), GHz(p.sweep.bandHi)];
  const ai = an.ai;
  const fa = res.freqs[ai];
  const stateLabel = (i) => `состояние ${i} (${fmtTrim(i * res.lsb)}°)`;
  const seq = (i, pal) => seqColor(pal, M > 1 ? i / (M - 1) : 0);
  const hx = (v) => `${fmt(v, 3)} ГГц`;

  if (key === 'polar') {
    let sumM = 0, sumT = 0;
    for (let k = 0; k < M; k++) {
      sumM += rel.ilM[k * nf + ai];
      sumT += rel.ilT[k * nf + ai];
    }
    const mM = sumM / M, mT = sumT / M;
    let maxDev = 0;
    const states = [];
    for (let k = 0; k < M; k++) {
      const idx = k * nf + ai;
      const ampM = 10 ** (-(rel.ilM[idx] - mM) / 20);
      const ampT = 10 ** (-(rel.ilT[idx] - mT) / 20);
      maxDev = Math.max(maxDev, Math.abs(ampM - 1), Math.abs(ampT - 1));
      states.push({ code: k, ideal: k * res.lsb, errM: rel.errM[idx], errT: rel.errT[idx], ampM, ampT });
    }
    return (c) => polarChart(c, {
      title: `Фазовые состояния на частоте ${fGHz(fa)}`,
      states, gain: p.sweep.polarGain, maxDev,
    });
  }

  if (key === 'phase') {
    const ys = [];
    for (let k = 0; k < M; k++) ys.push(stateSlice(rel.phM, k, nf));
    return (c) => lineChart(c, {
      title: 'Относительный фазовый сдвиг состояний (измерено)',
      xLabel: 'частота, ГГц', yLabel: 'фазовый сдвиг, °',
      yMin: -20, yMax: 380, yTicks: [0, 45, 90, 135, 180, 225, 270, 315, 360],
      fan: { x, ys, colorAt: seq, labelOf: stateLabel, width: 1.3 },
      band, vLines: [{ x: GHz(fa), color: palette().muted, dash: [2, 3], width: 1 }],
      hoverX: hx, hoverY: (v) => `${fmt(v, 2)}°`,
    });
  }

  if (key === 'errStates') {
    const eM = new Float64Array(M), eT = new Float64Array(M);
    for (let k = 0; k < M; k++) {
      eM[k] = rel.errM[k * nf + ai];
      eT[k] = rel.errT[k * nf + ai];
    }
    const lim = p.limits.peakPhaseDeg;
    return (c) => barChart(c, {
      title: `Фазовая ошибка по состояниям на частоте ${fGHz(fa)}`,
      xLabel: 'номер состояния', yLabel: 'ошибка, °', count: M,
      groups: [{ values: eM, color: palette().s1, label: 'измерено' }],
      markers: [{ values: eT, color: palette().s2, label: 'истинное значение' }],
      hLines: [{ y: lim, legend: 'норма пиковой ошибки' }, { y: -lim }],
      labelOf: stateLabel, hoverY: (v) => `${fmt(v, 3)}°`,
    });
  }

  if (key === 'rms') {
    const pal = palette();
    return (c) => lineChart(c, {
      title: 'СКО и пиковая фазовая ошибка от частоты',
      xLabel: 'частота, ГГц', yLabel: 'ошибка, °', includeZero: true,
      series: [
        { x, y: an.T.rms, color: pal.s2, label: 'СКО, истинное', width: 3.5 },
        { x, y: an.M.rms, color: pal.s1, label: 'СКО, измерено' },
        { x, y: an.M.peak, color: pal.s3, label: 'пиковая, измерено' },
      ],
      hLines: [{ y: p.limits.rmsPhaseDeg, legend: 'норма СКО' }],
      band, hoverX: hx, hoverY: (v) => `${fmt(v, 3)}°`,
    });
  }

  if (key === 'heat') {
    return (c) => heatmap(c, {
      title: 'Фазовая ошибка: состояние × частота (измерено)',
      xLabel: 'частота, ГГц', yLabel: 'номер состояния',
      x, rows: M, z: rel.errM, unit: '°', band,
      cellTitle: (k, fi) => `${stateLabel(k)}, ${fmt(x[fi], 3)} ГГц`, valueLabel: 'ошибка',
    });
  }

  if (key === 'accuracy') {
    const ys = [];
    for (let k = 1; k < M; k++) {
      const y = new Float64Array(nf);
      for (let fi = 0; fi < nf; fi++) y[fi] = wrap180(rel.phM[k * nf + fi] - rel.phT[k * nf + fi]);
      ys.push(y);
    }
    const lines = [];
    if (S.mc) lines.push({ y: 2 * S.mc.total.phase, legend: 'U(φ), k = 2, по Монте-Карло' }, { y: -2 * S.mc.total.phase });
    return (c) => lineChart(c, {
      title: 'Погрешность измерения фазы: измерено − истинное',
      xLabel: 'частота, ГГц', yLabel: 'погрешность, °',
      fan: { x, ys, colorAt: (i, pal) => seq(i + 1, pal), labelOf: (i) => stateLabel(i + 1), width: 1.1 },
      hLines: lines, band, hoverX: hx, hoverY: (v) => `${fmt(v, 4)}°`,
    });
  }

  if (key === 'il') {
    const ys = [];
    for (let k = 0; k < M; k++) ys.push(stateSlice(rel.ilM, k, nf));
    return (c) => lineChart(c, {
      title: 'Вносимые потери состояний (измерено)',
      xLabel: 'частота, ГГц', yLabel: 'потери, дБ',
      fan: { x, ys, colorAt: seq, labelOf: stateLabel, width: 1.1 },
      series: [{ x, y: an.M.ilMean, color: palette().s2, label: 'среднее по состояниям', width: 2.2 }],
      hLines: [{ y: p.limits.ilMaxDb, legend: 'норма потерь' }],
      band, hoverX: hx, hoverY: (v) => `${fmt(v, 3)} дБ`,
    });
  }

  if (key === 'vswr') {
    const ys = [];
    for (let k = 0; k < M; k++) ys.push(stateSlice(rel.vswrM, k, nf));
    return (c) => lineChart(c, {
      title: 'КСВН входа (измерено)',
      xLabel: 'частота, ГГц', yLabel: 'КСВН',
      fan: { x, ys, colorAt: seq, labelOf: stateLabel, width: 1.1 },
      series: [{ x, y: an.M.vswrMax, color: palette().s2, label: 'наибольший по состояниям', width: 2.2 }],
      hLines: [{ y: p.limits.vswrMax, legend: 'норма КСВН' }],
      band, hoverX: hx, hoverY: (v) => fmt(v, 3),
    });
  }

  if (key === 'dnl') {
    const lab = (i) => `переход ${i} → ${i + 1}`;
    return (c) => barChart(c, {
      title: `Дифференциальная нелинейность на частоте ${fGHz(fa)}`,
      xLabel: 'номер перехода', yLabel: 'DNL, МЗР', count: M - 1,
      groups: [{ values: an.dnlM, color: palette().s1, label: 'измерено' }],
      markers: [{ values: an.dnlT, color: palette().s2, label: 'истинное значение' }],
      hLines: [{ y: -1, legend: 'граница монотонности (−1 МЗР)' }],
      labelOf: lab, hoverY: (v) => `${fmt(v, 3)} МЗР`,
    });
  }

  if (key === 'scope') {
    const pal = palette();
    const rec = cap.rec;
    const n = Math.min(rec.M, Math.round((4 * rec.M) / rec.k0));
    const t = Float64Array.from({ length: n }, (_, i) => (i / rec.fsHz) * 1e3);
    return (c) => lineChart(c, {
      title: `Запись ПЧ после АЦП: состояние ${cap.k}, ${fGHz(cap.f)}`,
      xLabel: 'время, мс', yLabel: 'отсчёт, отн. ед.',
      series: [
        { x: t, y: cap.capture.r.xq.subarray(0, n), color: pal.s1, label: 'опорный канал R', markers: true, width: 1.5 },
        { x: t, y: cap.capture.b.xq.subarray(0, n), color: pal.s2, label: 'канал прошедшей волны B', markers: true, width: 1.5 },
      ],
      hoverX: (v) => `${fmt(v, 4)} мс`, hoverY: (v) => fmt(v, 5),
    });
  }

  if (key === 'spectrum') {
    const rec = cap.rec;
    const xq = cap.capture.b.xq;
    const half = rec.M / 2;
    const fx = new Float64Array(half + 1);
    const db = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < rec.M; n++) {
        const th = (2 * Math.PI * k * n) / rec.M;
        re += xq[n] * Math.cos(th);
        im -= xq[n] * Math.sin(th);
      }
      const amp = (Math.hypot(re, im) * (k === 0 || k === half ? 1 : 2)) / rec.M;
      fx[k] = (k * rec.fsHz) / rec.M / 1e3;
      db[k] = 20 * Math.log10(Math.max(amp / rec.fullScale, 1e-9));
    }
    return (c) => lineChart(c, {
      title: 'Спектр записи канала B',
      xLabel: 'частота, кГц', yLabel: 'уровень, дБ отн. полной шкалы АЦП',
      series: [{ x: fx, y: db, color: palette().s1, label: 'спектр', legend: false, markers: true, markerSize: 2, width: 1.2 }],
      vLines: [{ x: rec.ifHz / 1e3, color: palette().muted, dash: [2, 3], width: 1, label: 'ПЧ' }],
      hoverX: (v) => `${fmt(v, 3)} кГц`, hoverY: (v) => `${fmt(v, 1)} дБ`,
    });
  }
  return null;
}

// ---------- Вкладка «Бюджет неопределённости» ----------

export function mcDraw(key, R) {
  const pal = palette();
  if (key === 'hist') {
    const h = R.histStats;
    return (c) => histogram(c, {
      title: `Измеренное СКО фазовой ошибки на ${fGHz(R.freqs[R.center])}, ${R.runs} прогонов`,
      xLabel: 'СКО фазовой ошибки, °', values: R.hist, trueValue: h.rmsTrue, lo: h.lo, hi: h.hi, unit: '°',
    });
  }
  const budget = (field, unit, digits) => {
    const items = R.sources.filter((s) => s.enabled).map((s) => ({
      label: s.name, value: s.u[field], color: pal.s1, text: `${fmt(s.u[field], digits)} ${unit}`,
    }));
    items.push({ label: 'Суммарная (Монте-Карло)', value: R.total[field], color: pal.s2, strong: true, text: `${fmt(R.total[field], digits)} ${unit}` });
    items.push({ label: 'Корень из суммы квадратов', value: R.rss[field], color: pal.s3, strong: true, text: `${fmt(R.rss[field], digits)} ${unit}` });
    return items;
  };
  if (key === 'budget') {
    return (c) => hbarChart(c, {
      title: 'Стандартная неопределённость измерения фазы по источникам',
      xLabel: 'u(φ), °', items: budget('phase', '°', 4), valueLabel: 'u(φ)',
    });
  }
  if (key === 'budgetIl') {
    return (c) => hbarChart(c, {
      title: 'Стандартная неопределённость измерения потерь по источникам',
      xLabel: 'u(потерь), дБ', items: budget('il', 'дБ', 4), valueLabel: 'u(потерь)',
    });
  }
  if (key === 'perState') {
    return (c) => barChart(c, {
      title: 'Расширенная неопределённость фазы по состояниям (k = 2)',
      xLabel: 'номер состояния', yLabel: 'U(φ), °', count: R.nStates,
      groups: [{ values: R.perStateU, color: pal.s1 }],
      labelOf: (i) => `состояние ${i}`, hoverY: (v) => `${fmt(v, 4)}°`,
    });
  }
  return null;
}

// ---------- Вкладка «Методы измерения фазы» ----------

const METHOD_COLORS = ['s1', 's2', 's3', 's4', 's5'];

export function methodsDraw(key, R) {
  const pal = palette();
  if (key === 'sigma') {
    const x = Float64Array.from(R.snrs);
    return (c) => lineChart(c, {
      title: 'Среднеквадратическая погрешность оценки разности фаз',
      xLabel: 'отношение сигнал/шум в опорном канале, дБ', yLabel: 'СКП, ° (логарифмическая шкала)', yLog: true,
      series: [
        ...METHODS.map((m, i) => ({ x, y: R.rms[m.key], color: pal[METHOD_COLORS[i]], label: m.short, markers: true })),
        { x, y: R.crb, color: pal.text, label: 'граница Крамера — Рао', dash: [6, 4], width: 1.6 },
      ],
      hoverX: (v) => `ОСШ ${fmt(v, 1)} дБ`, hoverY: (v) => `${fmt(v, 4)}°`,
    });
  }
  if (key === 'bias') {
    const x = Float64Array.from(R.deltas);
    return (c) => lineChart(c, {
      title: `Систематическая погрешность от истинной разности фаз (ОСШ ${fmt(R.biasSnr ?? 0, 0)} дБ)`,
      xLabel: 'истинная разность фаз Δφ, °', yLabel: 'смещение оценки, °',
      xMin: 0, xMax: 355, xTicks: [0, 45, 90, 135, 180, 225, 270, 315],
      series: METHODS.map((m, i) => ({ x, y: R.biasCurve[m.key], color: pal[METHOD_COLORS[i]], label: m.short })),
      hoverX: (v) => `Δφ = ${fmt(v, 0)}°`, hoverY: (v) => `${fmt(v, 3)}°`,
    });
  }
  return null;
}

// ---------- Вкладка «Применение в ФАР» ----------

const SCEN_COLORS = { ideal: 's1', quant: 's2', nominal: 's3', calib: 's4' };

export function arrayDraw(key, R, p) {
  const pal = palette();
  const x = R.angles;
  const series = SCENARIOS.map((s) => ({ x, y: R.scenarios[s.key].db, color: pal[SCEN_COLORS[s.key]], label: s.name, width: s.key === 'ideal' ? 2.4 : 1.6 }));
  if (key === 'pattern') {
    return (c) => lineChart(c, {
      title: `Диаграмма направленности: ${p.array.elements} элементов, сканирование ${fmt(p.array.steerDeg, 1)}°, ${fGHz(p.array.freqHz)}`,
      xLabel: 'угол, °', yLabel: 'уровень, дБ отн. идеального максимума',
      xMin: -90, xMax: 90, yMin: -60, yMax: 3, xTicks: [-90, -60, -30, 0, 30, 60, 90],
      series, vLines: [{ x: p.array.steerDeg, color: pal.muted, dash: [2, 3], width: 1 }],
      hoverX: (v) => `${fmt(v, 1)}°`, hoverY: (v) => `${fmt(v, 2)} дБ`,
    });
  }
  if (key === 'beam') {
    const th = p.array.steerDeg;
    return (c) => lineChart(c, {
      title: 'Главный лепесток крупно',
      xLabel: 'угол, °', yLabel: 'уровень, дБ',
      xMin: Math.max(-90, th - 12), xMax: Math.min(90, th + 12), yMin: -12, yMax: 1,
      series, vLines: [{ x: th, color: pal.muted, dash: [2, 3], width: 1 }],
      hoverX: (v) => `${fmt(v, 1)}°`, hoverY: (v) => `${fmt(v, 3)} дБ`,
    });
  }
  if (key === 'elements') {
    return (c) => barChart(c, {
      title: 'Фазовые ошибки элементов решётки',
      xLabel: 'номер элемента', yLabel: 'ошибка фазы, °', count: p.array.elements,
      xFormat: (v) => String(v + 1),
      groups: [
        { values: R.scenarios.nominal.errs, color: pal.s3, label: 'по номиналу' },
        { values: R.scenarios.calib.errs, color: pal.s4, label: 'по таблице калибровки' },
      ],
      markers: [{ values: R.scenarios.quant.errs, color: pal.s2, label: 'только дискретность', shape: 'dot' }],
      labelOf: (i) => `элемент ${i + 1}`, hoverY: (v) => `${fmt(v, 3)}°`,
    });
  }
  return null;
}

// ---------- Таблицы ----------

function cell(tr, text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  tr.appendChild(td);
  return td;
}

function valueText(r, v) {
  if (r.bool) return v ? 'да' : 'нет';
  return `${fmt(v, r.digits)}${r.unit ? ' ' + r.unit : ''}`;
}

export function renderVerdict(tbody, rows) {
  tbody.textContent = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    cell(tr, r.name);
    cell(tr, valueText(r, r.meas), 'num strong');
    cell(tr, valueText(r, r.truth), 'num muted');
    cell(tr, r.bool ? '—' : `${fmt(r.meas - r.truth, r.digits + 1)}${r.unit ? ' ' + r.unit : ''}`, 'num muted');
    cell(tr, r.bool ? r.limit : `${r.cmp} ${fmt(r.limit, r.digits > 2 ? 2 : r.digits)}${r.unit ? ' ' + r.unit : ''}`, 'num muted');
    if (r.info) {
      cell(tr, 'справочно', 'mark info');
      cell(tr, '—', 'mark info');
    } else {
      cell(tr, r.pass ? 'годен' : 'не годен', `mark ${r.pass ? 'pass' : 'fail'}`);
      cell(tr, r.truePass ? 'годен' : 'не годен', `mark ${r.truePass ? 'pass' : 'fail'}`);
    }
    tbody.appendChild(tr);
  }
}

export function renderBits(tbody, res, an) {
  tbody.textContent = '';
  res.dut.bits.forEach((bit, i) => {
    const b = an.bits[i];
    const tr = document.createElement('tr');
    cell(tr, `${fmtTrim(bit.shift)}°`, "num strong");
    cell(tr, KIND_NAMES[bit.kind]);
    cell(tr, describeBit(bit), 'muted');
    cell(tr, `${fmt(b.phM, 2)}°`, 'num');
    cell(tr, `${fmt(b.phT, 2)}°`, 'num muted');
    cell(tr, `${fmt(b.phM - bit.shift, 2)}°`, 'num');
    cell(tr, `${fmt(b.ilM, 2)} дБ`, 'num');
    tbody.appendChild(tr);
  });
}

export function renderTiles(box, tiles) {
  box.textContent = '';
  for (const t of tiles) {
    const d = document.createElement('div');
    d.className = 'tile';
    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = t.label;
    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = t.value;
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = t.note || '';
    d.append(l, v, n);
    box.appendChild(d);
  }
}

export function renderMc(tbody, R) {
  tbody.textContent = '';
  let sumVar = 0;
  for (const s of R.sources) if (s.enabled) sumVar += s.u.phase ** 2;
  for (const s of R.sources) {
    const tr = document.createElement('tr');
    cell(tr, s.name);
    if (!s.enabled) {
      cell(tr, 'источник отключён', 'muted');
      cell(tr, '');
      cell(tr, '');
      cell(tr, '');
    } else {
      cell(tr, fmt(s.u.phase, 4), 'num');
      cell(tr, sumVar > 0 ? `${fmt((100 * s.u.phase ** 2) / sumVar, 1)} %` : '—', 'num muted');
      cell(tr, fmt(s.u.il, 4), 'num');
      cell(tr, fmt(s.u.phaseBias, 4), 'num muted');
    }
    tbody.appendChild(tr);
  }
  const add = (name, ph, il, bias) => {
    const tr = document.createElement('tr');
    tr.className = 'total';
    cell(tr, name);
    cell(tr, fmt(ph, 4), 'num');
    cell(tr, '');
    cell(tr, fmt(il, 4), 'num');
    cell(tr, bias === undefined ? '' : fmt(bias, 4), 'num');
    tbody.appendChild(tr);
  };
  add('Суммарная стандартная неопределённость (Монте-Карло)', R.total.phase, R.total.il, R.total.phaseBias);
  add('Корень из суммы квадратов вкладов', R.rss.phase, R.rss.il);
  add('Расширенная неопределённость U, k = 2', 2 * R.total.phase, 2 * R.total.il);
}

export function renderMethods(tbody, R) {
  tbody.textContent = '';
  const pal = palette();
  R.table.forEach((m, i) => {
    const tr = document.createElement('tr');
    const td = cell(tr, '');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = pal[METHOD_COLORS[i]];
    td.append(sw, document.createTextNode(m.name));
    cell(tr, fmt(m.rms, 4), 'num strong');
    cell(tr, fmt(m.bias, 4), 'num');
    cell(tr, fmt(m.std, 4), 'num');
    cell(tr, fmt(m.ratio, 2), 'num');
    cell(tr, fmt(m.maxBias, 3), 'num');
    cell(tr, m.range, 'muted');
    tbody.appendChild(tr);
  });
}

export function renderArray(tbody, R) {
  tbody.textContent = '';
  const pal = palette();
  for (const s of SCENARIOS) {
    const r = R.scenarios[s.key];
    const tr = document.createElement('tr');
    const td = cell(tr, '');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = pal[SCEN_COLORS[s.key]];
    td.append(sw, document.createTextNode(s.name));
    cell(tr, `${fmt(r.peakAngle, 1)}°`, 'num');
    cell(tr, `${fmt(r.pointErr, 1)}°`, 'num');
    cell(tr, `${fmt(r.gainDb, 3)} дБ`, 'num');
    cell(tr, `${fmt(r.sllDb, 2)} дБ`, 'num strong');
    cell(tr, `${fmt(r.rmsPhase, 3)}°`, 'num');
    cell(tr, `${fmt(r.rmsAmpDb, 3)} дБ`, 'num');
    tbody.appendChild(tr);
  }
}
