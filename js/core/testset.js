// Модель погрешностей измерительного тракта: калибровка, рассогласование, утечки, дрейф (раздел 2.2 ТЗ)

import { cx, add, sub, mul, div, polar } from './complex.js';
import { SID, stream } from './rng.js';

export const CAL_MODES = {
  none: 'Без калибровки',
  response: 'Нормировка по перемычке',
  full: 'Полная двухпортовая калибровка',
};

export const STRATEGIES = {
  sequential: 'Последовательно, опорное состояние один раз',
  interleaved: 'С повторным измерением опорного состояния',
};

const TERM = { edf: 1, esf: 2, elf: 3, exf: 4, etf: 5, erf: 6, drift: 7 };

// Какие члены модели ошибок заменяются остаточными значениями после калибровки
const RESIDUAL = {
  none: { edf: false, esf: false, elf: false, exf: false, etf: false, erf: false },
  response: { edf: false, esf: false, elf: false, exf: false, etf: true, erf: true },
  full: { edf: true, esf: true, elf: true, exf: true, etf: true, erf: true },
};

const dbToLin = (x) => 10 ** (x / 20);

// Систематические погрешности одного прогона: модули заданы, фазы и задержки случайны
export function makeTestSet(sys, run, sources) {
  const resid = RESIDUAL[sys.cal];
  const draw = (id) => {
    const r = stream(SID.terms, sys.seed, run, id);
    return [r(), r()];
  };

  const small = (name) => {
    const [u1, u2] = draw(TERM[name]);
    const level = resid[name] ? sys.res[name + 'Db'] : sys.raw[name + 'Db'];
    return { mag: dbToLin(level), phase: 2 * Math.PI * u1, tau: (0.2 + 1.3 * u2) * 1e-9 };
  };

  const tracking = (name, paths) => {
    const [u1, u2] = draw(TERM[name]);
    if (resid[name]) {
      return {
        mag: dbToLin((2 * u1 - 1) * sys.res.trackDb),
        phase: ((2 * u2 - 1) * sys.res.trackDeg * Math.PI) / 180,
        tau: 0,
      };
    }
    return {
      mag: dbToLin(-paths * sys.raw.cableLossDb),
      phase: 2 * Math.PI * u1,
      tau: paths * sys.raw.cableDelayNs * 1e-9,
    };
  };

  const t = {
    edf: small('edf'),
    esf: small('esf'),
    elf: small('elf'),
    exf: small('exf'),
    etf: tracking('etf', 1),
    erf: tracking('erf', 2),
  };

  if (!sources.mismatch) {
    t.esf.mag = 0;
    t.elf.mag = 0;
  }
  if (!sources.leakage) {
    t.edf.mag = 0;
    t.exf.mag = 0;
  }
  if (!sources.tracking) {
    t.etf = { mag: 1, phase: 0, tau: 0 };
    t.erf = { mag: 1, phase: 0, tau: 0 };
  }

  // В основном измерении (прогон 0) дрейф задан детерминированно, в прогонах
  // Монте-Карло его скорость равномерно распределена в пределах ±заданного значения
  const [d1, d2] = draw(TERM.drift);
  let driftDeg = run === 0 ? sys.driftDegMin : (2 * d1 - 1) * sys.driftDegMin;
  let driftDb = run === 0 ? sys.driftDbMin : (2 * d2 - 1) * sys.driftDbMin;
  if (!sources.drift) {
    driftDeg = 0;
    driftDb = 0;
  }

  const val = (term, f) => polar(term.mag, term.phase - 2 * Math.PI * f * term.tau);

  return {
    terms: t,
    driftDeg,
    driftDb,
    at(f, time) {
      const minutes = time / 60;
      const drift = polar(dbToLin(driftDb * minutes), (-driftDeg * minutes * Math.PI) / 180);
      return {
        edf: val(t.edf, f),
        esf: val(t.esf, f),
        elf: val(t.elf, f),
        exf: val(t.exf, f),
        etf: mul(val(t.etf, f), drift),
        erf: mul(val(t.erf, f), drift),
      };
    },
  };
}

// Прямая модель ошибок двухпортового измерения (направление «порт 1 → порт 2»)
export function applyErrors(E, s11, s21, s12, s22) {
  const delta = sub(mul(s11, s22), mul(s12, s21));
  const den = add(sub(sub(cx(1, 0), mul(E.esf, s11)), mul(E.elf, s22)), mul(mul(E.esf, E.elf), delta));
  return {
    s21: add(E.exf, div(mul(E.etf, s21), den)),
    s11: add(E.edf, div(mul(E.erf, sub(s11, mul(E.elf, delta))), den)),
  };
}

// Временная диаграмма измерения: длительность точки, развёртки и всего цикла
export function timing(sys, sweep, nStates) {
  const tPoint = 1 / sys.ifbwHz + sys.settleUs * 1e-6;
  const tState = sweep.points * tPoint + sys.switchMs * 1e-3;
  const slots = sys.strategy === 'interleaved' ? Math.max(1, 2 * (nStates - 1)) : nStates;
  return { tPoint, tState, slots, total: slots * tState };
}

// Момент измерения состояния k на частоте f (isRef — повторное измерение опорного состояния)
export function pointTime(sys, sweep, tm, k, f, isRef) {
  const span = sweep.stop - sweep.start;
  const pos = span > 0 ? ((sweep.points - 1) * (f - sweep.start)) / span : 0;
  const within = pos * tm.tPoint;
  if (sys.strategy === 'interleaved') {
    if (k === 0) return within;
    return (isRef ? 2 * (k - 1) : 2 * k - 1) * tm.tState + within;
  }
  return k * tm.tState + within;
}
