// Бюджет неопределённости измерения методом Монте-Карло (раздел 2.4 ТЗ)
//
// Объект измерения в каждом прогоне один и тот же, меняются только реализации погрешностей
// измерительной системы: шум, фазы остаточных членов модели ошибок, скорость дрейфа.
// Вклад каждого источника оценивается отдельной серией прогонов, в которой включён
// только он; суммарная неопределённость — серией со всеми источниками.

import { designDut, trueSweep } from './dut.js';
import { runMeasurement, relative, freqMetrics, linspace, wrap180, dutParams } from './measure.js';

export const SOURCES = [
  { key: 'noise', name: 'Тепловой шум приёмника' },
  { key: 'quant', name: 'Квантование АЦП' },
  { key: 'mismatch', name: 'Остаточное рассогласование портов' },
  { key: 'leakage', name: 'Направленность и перекрёстная утечка' },
  { key: 'tracking', name: 'Неидеальность передачи тракта' },
  { key: 'drift', name: 'Дрейф тракта во времени' },
];

const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));

function onlySource(all, key) {
  const out = {};
  for (const k of Object.keys(all)) out[k] = k === key;
  return out;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function runMonteCarlo(p, { onProgress, isCancelled } = {}) {
  const freqs = linspace(p.sweep.bandLo, p.sweep.bandHi, p.mc.freqPoints);
  const dut = designDut(dutParams(p));
  const trueS = trueSweep(dut, freqs);
  const M = dut.nStates;
  const nf = freqs.length;
  const runs = p.mc.runs;
  const center = Math.floor(nf / 2);

  const enabled = SOURCES.filter((s) => p.sys.sources[s.key]);
  const configs = [
    { key: 'all', sources: { ...p.sys.sources } },
    ...enabled.map((s) => ({ key: s.key, sources: onlySource(p.sys.sources, s.key) })),
  ];

  const acc = {};
  for (const c of configs) acc[c.key] = { ph2: 0, ph: 0, nPh: 0, il2: 0, il: 0, nIl: 0 };

  const perState2 = new Float64Array(M);
  const hist = new Float64Array(runs);
  const runRows = [];
  let rmsTrue = NaN;

  const total = configs.length * runs;
  let done = 0;
  let lastYield = performance.now();

  for (const cfg of configs) {
    const a = acc[cfg.key];
    for (let run = 1; run <= runs; run++) {
      const res = runMeasurement(p, { freqs, run, sources: cfg.sources, dut, trueS });
      const rel = relative(res);

      for (let k = 0; k < M; k++) {
        for (let fi = 0; fi < nf; fi++) {
          const idx = k * nf + fi;
          const di = rel.ilM[idx] - rel.ilT[idx];
          a.il2 += di * di;
          a.il += di;
          a.nIl++;
          if (k === 0) continue;
          const e = wrap180(rel.phM[idx] - rel.phT[idx]);
          a.ph2 += e * e;
          a.ph += e;
          a.nPh++;
          if (cfg.key === 'all') perState2[k] += e * e;
        }
      }

      if (cfg.key === 'all') {
        const fm = freqMetrics(rel, M, nf, 'M');
        hist[run - 1] = fm.rms[center];
        if (run === 1) rmsTrue = freqMetrics(rel, M, nf, 'T').rms[center];
        runRows.push({
          run,
          rmsCenter: fm.rms[center],
          peakCenter: fm.peak[center],
          ilMeanCenter: fm.ilMean[center],
        });
      }

      done++;
      if (performance.now() - lastYield > 40) {
        onProgress?.(done / total);
        await yieldUI();
        lastYield = performance.now();
        if (isCancelled?.()) throw new Error('Моделирование прервано');
      }
    }
  }
  onProgress?.(1);

  const u = {};
  for (const c of configs) {
    const a = acc[c.key];
    u[c.key] = {
      phase: Math.sqrt(a.ph2 / a.nPh),
      phaseBias: a.ph / a.nPh,
      il: Math.sqrt(a.il2 / a.nIl),
      ilBias: a.il / a.nIl,
    };
  }

  let rssPh = 0;
  let rssIl = 0;
  for (const s of enabled) {
    rssPh += u[s.key].phase ** 2;
    rssIl += u[s.key].il ** 2;
  }

  const perStateU = new Float64Array(M);
  for (let k = 1; k < M; k++) perStateU[k] = 2 * Math.sqrt(perState2[k] / (runs * nf));

  const sorted = Array.from(hist).sort((x, y) => x - y);
  let mean = 0;
  for (const v of hist) mean += v;
  mean /= runs;
  let varS = 0;
  for (const v of hist) varS += (v - mean) ** 2;
  const std = runs > 1 ? Math.sqrt(varS / (runs - 1)) : 0;

  return {
    freqs, center, runs, nStates: M,
    sources: SOURCES.map((s) => ({ ...s, enabled: !!p.sys.sources[s.key], u: u[s.key] || null })),
    total: u.all,
    rss: { phase: Math.sqrt(rssPh), il: Math.sqrt(rssIl) },
    perStateU,
    hist,
    histStats: {
      mean, std, rmsTrue,
      lo: quantile(sorted, 0.025),
      hi: quantile(sorted, 0.975),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    },
    runRows,
  };
}
