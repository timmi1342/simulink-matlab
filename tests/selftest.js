// Самотест вычислительного ядра: сверка с аналитическими соотношениями (раздел 5 ТЗ)

import { mulberry32, streamSeed, gaussianPair } from '../js/core/rng.js';
import { cx, abs, arg, div, toS, tline, seriesZ, parallel, chain } from '../js/core/complex.js';
import { designDut, dutS, bitMatrix, Z0 } from '../js/core/dut.js';
import { runMeasurement, analyze, relative, freqMetrics, wrap180, linspace } from '../js/core/measure.js';
import { runMonteCarlo } from '../js/core/montecarlo.js';
import { makeContext, trial, crbDeg, wrapPi } from '../js/core/methods.js';
import { pattern, lobeMetrics, runArray } from '../js/core/array.js';
import { defaultParams, validate } from '../js/params.js';

const results = [];
const check = (group, name, ok, detail = '') => results.push({ group, name, pass: !!ok, detail });
const f6 = (v) => (Number.isFinite(v) ? v.toExponential(3) : String(v));

const NONE = { noise: false, quant: false, mismatch: false, leakage: false, tracking: false, drift: false };

function only(p, keys) {
  p.sys.sources = { ...NONE };
  for (const k of keys) p.sys.sources[k] = true;
  return p;
}

function ideal(topology, bits = 6, coff = 0) {
  return designDut({ bits, topology, f0: 10e9, ron: 0, coff, qL: 1e15, qC: 1e15, lineLossDb: 0, tolPct: 0, instance: 1 });
}

function stateErrors(d, f) {
  const s0 = dutS(d, f, 0);
  let maxE = 0, maxS11 = 0;
  for (let k = 0; k < d.nStates; k++) {
    const s = dutS(d, f, k);
    const e = wrap180((arg(s0.s21) - arg(s.s21)) * 180 / Math.PI - k * d.lsb);
    maxE = Math.max(maxE, Math.abs(e));
    maxS11 = Math.max(maxS11, abs(s.s11));
  }
  return { maxE, maxS11 };
}

export async function run() {
  // 1. Генератор случайных чисел
  {
    const r = mulberry32(1);
    const v = [r(), r(), r()];
    check('Генератор', 'Первые значения mulberry32(1) совпадают с эталоном',
      Math.abs(v[0] - 0.6270739405881613) < 1e-15 && Math.abs(v[1] - 0.002735721180215478) < 1e-15,
      v.map((x) => x.toFixed(12)).join(', '));
    const g = mulberry32(7);
    let s = 0, s2 = 0;
    const n = 100000;
    for (let i = 0; i < n / 2; i++) {
      const [a, b] = gaussianPair(g);
      s += a + b;
      s2 += a * a + b * b;
    }
    const mean = s / n, variance = s2 / n - mean * mean;
    check('Генератор', 'Нормальное распределение: среднее 0, дисперсия 1',
      Math.abs(mean) < 0.01 && Math.abs(variance - 1) < 0.02, `среднее ${mean.toFixed(4)}, дисперсия ${variance.toFixed(4)}`);
    check('Генератор', 'Независимые потоки различаются, одинаковые — совпадают',
      streamSeed(1, 2, 3) === streamSeed(1, 2, 3) && streamSeed(1, 2, 3) !== streamSeed(1, 3, 2));
  }

  // 2. Матрицы передачи
  {
    const th = 0.7;
    const s = toS(tline(Z0, th, 0), Z0);
    check('Четырёхполюсники', 'Согласованная линия без потерь: |S21| = 1, arg S21 = −θ, S11 = 0',
      Math.abs(abs(s.s21) - 1) < 1e-12 && Math.abs(arg(s.s21) + th) < 1e-12 && abs(s.s11) < 1e-12);
    const sl = toS(tline(Z0, th, 0.1), Z0);
    check('Четырёхполюсники', 'Потери линии: |S21| = exp(−αl)', Math.abs(abs(sl.s21) - Math.exp(-0.1)) < 1e-12);
    const z1 = cx(30, 10), z2 = cx(80, -40);
    const par = parallel(seriesZ(z1), seriesZ(z2));
    const zp = div(cx(z1.re * z2.re - z1.im * z2.im, z1.re * z2.im + z1.im * z2.re), cx(z1.re + z2.re, z1.im + z2.im));
    check('Четырёхполюсники', 'Параллельное соединение последовательных сопротивлений даёт Z1·Z2/(Z1+Z2)',
      abs(cx(par.b.re - zp.re, par.b.im - zp.im)) < 1e-9);
  }

  // 3. Модель фазовращателя
  for (const topo of ['switched', 'hplp', 'mixed']) {
    const { maxE, maxS11 } = stateErrors(ideal(topo), 10e9);
    check('Фазовращатель', `Идеальная схема «${topo}» на f0: все 64 состояния точны и согласованы`,
      maxE < 1e-9 && maxS11 < 1e-9, `ошибка ${f6(maxE)}°, |S11| ${f6(maxS11)}`);
  }
  {
    const d = ideal('mixed', 6, 20e-15);
    let worst = 0, s11 = 0;
    for (const bit of d.bits.filter((b) => b.kind === 'loaded')) {
      const s0 = toS(bitMatrix(d, bit, 10e9, false), Z0);
      const s1 = toS(bitMatrix(d, bit, 10e9, true), Z0);
      worst = Math.max(worst, Math.abs(wrap180((arg(s0.s21) - arg(s1.s21)) * 180 / Math.PI - bit.shift)));
      s11 = Math.max(s11, abs(s0.s11), abs(s1.s11));
    }
    check('Фазовращатель', 'Нагруженная линия рассчитана с учётом Coff: сдвиг точен на f0',
      worst < 1e-9 && s11 < 1e-9, `ошибка ${f6(worst)}°, |S11| ${f6(s11)}`);
  }
  {
    const p = defaultParams();
    const d = designDut({ ...p.dut, coff: p.dut.coffFf * 1e-15 });
    let recip = 0, passive = true;
    for (const f of [7e9, 10e9, 13e9]) {
      for (let k = 0; k < d.nStates; k++) {
        const s = dutS(d, f, k);
        recip = Math.max(recip, abs(cx(s.s12.re - s.s21.re, s.s12.im - s.s21.im)));
        if (abs(s.s11) ** 2 + abs(s.s21) ** 2 > 1 + 1e-12) passive = false;
      }
    }
    check('Фазовращатель', 'Взаимность S12 = S21 для всех состояний', recip < 1e-12, f6(recip));
    check('Фазовращатель', 'Пассивность |S11|² + |S21|² ≤ 1', passive);
  }

  // 4. Измерительная система
  const base = () => {
    const p = defaultParams();
    p.sweep.points = 21;
    return p;
  };
  {
    const p = only(base(), []);
    const an = analyze(runMeasurement(p), p);
    check('Измерение', 'Без погрешностей измеренные параметры равны истинным',
      an.acc.phaseMax < 1e-9 && an.acc.ilMax < 1e-9, `фаза ${f6(an.acc.phaseMax)}°, потери ${f6(an.acc.ilMax)} дБ`);
  }
  {
    const p = only(base(), ['tracking']);
    p.sys.cal = 'none';
    const an = analyze(runMeasurement(p), p);
    check('Измерение', 'Неидеальность передачи тракта не влияет на относительную фазу',
      an.acc.phaseMax < 1e-9, `${f6(an.acc.phaseMax)}°`);
    check('Измерение', 'Без калибровки потери завышены на потери кабелей (3 дБ)',
      Math.abs(an.acc.ilMean - p.sys.raw.cableLossDb) < 0.01, `${an.acc.ilMean.toFixed(4)} дБ`);
  }
  {
    const p = only(base(), ['noise']);
    p.sys.powerDbm = -60;
    const res = runMeasurement(p);
    const rel = relative(res);
    const snr0 = 10 ** (res.rec.snr0Db / 10);
    const nf = res.freqs.length;
    const K = res.nStates - 1;
    // Шум опорного состояния 0 одинаков для всех k на данной частоте и исключается
    // вычитанием среднего по состояниям; остаётся дисперсия σk² = (1 + 1/|S21,k|²)/(2·ОСШ)
    let e2 = 0, t2 = 0;
    for (let fi = 0; fi < nf; fi++) {
      const e = [];
      let mean = 0;
      for (let k = 1; k <= K; k++) {
        const i = k * nf + fi;
        e.push(wrap180(rel.phM[i] - rel.phT[i]) * Math.PI / 180);
        mean += e[e.length - 1] / K;
      }
      for (let k = 1; k <= K; k++) {
        const i = k * nf + fi;
        const gk = res.trueS.s21re[i] ** 2 + res.trueS.s21im[i] ** 2;
        e2 += (e[k - 1] - mean) ** 2;
        t2 += ((1 + 1 / gk) / (2 * snr0)) * (1 - 1 / K);
      }
    }
    const ratio = Math.sqrt(e2 / t2);
    check('Измерение', 'Шумовая погрешность фазы совпадает с теорией σ² = (1 + 1/|S21|²)/(2·ОСШ) на измерение',
      ratio > 0.92 && ratio < 1.08, `отношение расчёта к теории ${ratio.toFixed(4)}`);
  }
  {
    const p = only(base(), ['mismatch']);
    p.sys.cal = 'none';
    const res = runMeasurement(p);
    const rel = relative(res);
    const t = res.testSet.terms;
    const nf = res.freqs.length;
    const S = res.trueS;
    const bound = (i) => t.esf.mag * Math.hypot(S.s11re[i], S.s11im[i]) + t.elf.mag * Math.hypot(S.s22re[i], S.s22im[i])
      + t.esf.mag * t.elf.mag * (S.s21re[i] ** 2 + S.s21im[i] ** 2 + Math.hypot(S.s11re[i], S.s11im[i]) * Math.hypot(S.s22re[i], S.s22im[i]));
    let worst = 0;
    for (let k = 1; k < res.nStates; k++) {
      for (let fi = 0; fi < nf; fi++) {
        const i = k * nf + fi;
        const e = Math.abs(wrap180(rel.phM[i] - rel.phT[i])) * Math.PI / 180;
        worst = Math.max(worst, e / (1.05 * (bound(i) + bound(fi))));
      }
    }
    check('Измерение', 'Погрешность от рассогласования не превышает оценку |Es||S11| + |El||S22| + ...',
      worst <= 1, `наибольшее отношение к оценке ${worst.toFixed(3)}`);
  }
  {
    const p = only(base(), ['drift']);
    p.sys.driftDegMin = 0.5;
    p.sys.ifbwHz = 100;
    const res = runMeasurement(p);
    const rel = relative(res);
    const nf = res.freqs.length;
    const k = res.nStates - 1;
    const dt = k * res.timing.tState;
    const expect = -(-p.sys.driftDegMin * dt / 60);
    const got = rel.phM[k * nf] - rel.phT[k * nf];
    check('Измерение', 'Дрейф при последовательном измерении: погрешность = скорость × время',
      Math.abs(got - expect) < 1e-6, `расчёт ${got.toFixed(5)}°, теория ${expect.toFixed(5)}°`);
    p.sys.strategy = 'interleaved';
    const an = analyze(runMeasurement(p), p);
    const lim = p.sys.driftDegMin * (res.timing.tState + 1e-9) / 60 * 1.001;
    check('Измерение', 'Повторное измерение опорного состояния ограничивает дрейф одной развёрткой',
      an.acc.phaseMax <= lim, `${an.acc.phaseMax.toFixed(5)}° ≤ ${lim.toFixed(5)}°`);
  }
  {
    const p = only(base(), ['quant']);
    p.sys.adcBits = 8;
    const e8 = analyze(runMeasurement(p), p).acc.phaseRms;
    p.sys.adcBits = 16;
    const e16 = analyze(runMeasurement(p), p).acc.phaseRms;
    check('Измерение', 'Погрешность квантования убывает с ростом разрядности АЦП',
      e8 > 0 && e16 < e8 / 50, `8 разрядов ${f6(e8)}°, 16 разрядов ${f6(e16)}°`);
  }
  {
    const p = base();
    const a = runMeasurement(p);
    const b = runMeasurement(p);
    let same = true;
    for (let i = 0; i < a.m21re.length; i++) if (a.m21re[i] !== b.m21re[i]) same = false;
    p.sys.seed = 2;
    const c = runMeasurement(p);
    check('Измерение', 'Результат воспроизводим при том же зерне и меняется при другом',
      same && c.m21re[5] !== a.m21re[5]);
  }

  // 5. Расчёт параметров
  {
    const M = 4, nf = 1;
    const rel = {
      errT: Float64Array.from([0, 1, -2, 3]), phT: Float64Array.from([0, 91, 178, 273]),
      ilT: Float64Array.from([2, 3, 2, 3]), vswrT: Float64Array.from([1.2, 1.5, 1.1, 1.3]),
    };
    const fm = freqMetrics(rel, M, nf, 'T');
    check('Параметры', 'СКО фазовой ошибки = √(Σe²/(M−1)), пиковая = max|e|',
      Math.abs(fm.rms[0] - Math.sqrt(14 / 3)) < 1e-12 && fm.peak[0] === 3);
    check('Параметры', 'СКО амплитудной ошибки относительно среднего по состояниям', Math.abs(fm.rmsAmp[0] - 0.5) < 1e-12);
    rel.phT = Float64Array.from([0, 91, 90.5, 273]);
    check('Параметры', 'Нарушение монотонности обнаруживается', freqMetrics(rel, M, nf, 'T').mono[0] === 0);
  }

  // 6. Бюджет неопределённости
  {
    const p = base();
    p.mc = { runs: 20, freqPoints: 2 };
    p.sys.powerDbm = -50;
    const R = await runMonteCarlo(p);
    const srcMax = Math.max(...R.sources.filter((s) => s.enabled).map((s) => s.u.phase));
    check('Монте-Карло', 'Суммарная неопределённость не меньше наибольшего вклада', R.total.phase >= srcMax * 0.95,
      `суммарная ${R.total.phase.toFixed(4)}°, наибольший вклад ${srcMax.toFixed(4)}°`);
    check('Монте-Карло', 'Сумма квадратов вкладов согласуется с совместным моделированием',
      Math.abs(R.rss.phase / R.total.phase - 1) < 0.25, `${R.rss.phase.toFixed(4)}° и ${R.total.phase.toFixed(4)}°`);
    check('Монте-Карло', 'Неидеальность передачи тракта даёт нулевой вклад в фазу',
      R.sources.find((s) => s.key === 'tracking').u.phase < 1e-9);
  }

  // 7. Методы измерения фазы
  {
    const mp = { ...defaultParams().methods, harmonicOn: false, adcBits: 24, iqGainDb: 0, iqPhaseDeg: 0, spErrDeg: 0, spComp: 0, window: 'rect' };
    const ctx = makeContext(mp);
    const est = trial(ctx, 300, 1.1, 0.4, mulberry32(3));
    check('Методы', 'Без шума и искажений ДПФ, квадратурный демодулятор и шестиполюсник точны',
      ['dft', 'iq', 'sp'].every((k) => Math.abs(wrapPi(est[k] - 1.1)) < 1e-9),
      ['dft', 'iq', 'sp'].map((k) => `${k}: ${f6(Math.abs(wrapPi(est[k] - 1.1)))} рад`).join(', '));
    const zc = Math.abs(wrapPi(est.zc - 1.1)) * 180 / Math.PI;
    check('Методы', 'Переходы через ноль: погрешность линейной интерполяции мала (< 0,1°)', zc < 0.1, `${f6(zc)}°`);
    const est2 = trial(ctx, 300, (270 * Math.PI) / 180, 0.2, mulberry32(4));
    check('Методы', 'Фазовый детектор однозначен только в 0…180°: 270° читается как 90°',
      Math.abs(est2.pd - Math.PI / 2) < 1e-6);
    let e2 = 0;
    const T = 400;
    for (let t = 0; t < T; t++) {
      const r = mulberry32(1000 + t);
      const phi = 2 * Math.PI * r();
      const e = wrapPi(trial(ctx, 20, 0.8, phi, r).dft - 0.8) * 180 / Math.PI;
      e2 += e * e;
    }
    const ratio = Math.sqrt(e2 / T) / crbDeg(mp, 20);
    check('Методы', 'Метод ДПФ достигает границы Крамера — Рао', ratio > 0.85 && ratio < 1.15, `СКП / граница ${ratio.toFixed(3)}`);
  }

  // 8. Антенная решётка
  {
    const N = 32;
    const amp = new Float64Array(N).fill(1);
    const phase = new Float64Array(N);
    const angles = linspace(-90, 90, 3601);
    const lm = lobeMetrics(pattern(amp, phase, 0.5, angles), angles);
    check('ФАР', 'Равномерная решётка: максимум на нормали, УБЛ ≈ −13,2 дБ',
      Math.abs(lm.peakAngle) < 0.06 && Math.abs(lm.sllDb + 13.2) < 0.3, `${lm.peakAngle.toFixed(2)}°, ${lm.sllDb.toFixed(2)} дБ`);
    const p = defaultParams();
    const R = runArray(p);
    check('ФАР', 'Идеальные фазовращатели наводят луч точно в заданном направлении',
      Math.abs(R.scenarios.ideal.pointErr) < 0.06 && Math.abs(R.scenarios.ideal.gainDb) < 1e-9);
    check('ФАР', 'Калибровка по измерениям уменьшает СКО фазовой ошибки элементов',
      R.scenarios.calib.rmsPhase < R.scenarios.nominal.rmsPhase,
      `${R.scenarios.nominal.rmsPhase.toFixed(3)}° → ${R.scenarios.calib.rmsPhase.toFixed(3)}°`);
  }

  // 9. Проверка ввода
  {
    const p = defaultParams();
    check('Ввод', 'Значения по умолчанию корректны', validate(p).ok);
    p.dut.bits = 7;
    p.sweep.stop = 5e9;
    p.sys.recordLen = 100;
    const v = validate(p);
    check('Ввод', 'Недопустимые значения обнаруживаются',
      !v.ok && v.errors['dut.bits'] && v.errors['sweep.stop'] && v.errors['sys.recordLen']);
  }

  return results;
}
