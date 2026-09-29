// Параметры моделирования, предустановки, проверка ввода (разделы 2.7, 3 ТЗ)

export function defaultParams() {
  return {
    dut: {
      bits: 6,
      topology: 'mixed',
      f0: 10e9,
      ron: 3,
      coffFf: 20,
      qL: 30,
      qC: 80,
      lineLossDb: 0.5,
      tolPct: 1.5,
      instance: 1,
    },

    sys: {
      powerDbm: -10,
      nfDb: 30,
      ifbwHz: 1000,
      recordLen: 128,
      adcBits: 14,
      headroomDb: 3,
      cal: 'full',
      res: { esfDb: -38, elfDb: -40, edfDb: -45, exfDb: -100, trackDb: 0.02, trackDeg: 0.2 },
      raw: { esfDb: -16, elfDb: -18, edfDb: -25, exfDb: -80, cableLossDb: 3, cableDelayNs: 2.5 },
      driftDegMin: 0.02,
      driftDbMin: 0.001,
      strategy: 'sequential',
      settleUs: 20,
      switchMs: 1,
      sources: { noise: true, quant: true, mismatch: true, leakage: true, tracking: true, drift: true },
      seed: 1,
    },

    sweep: {
      start: 7e9,
      stop: 13e9,
      points: 61,
      bandLo: 9.5e9,
      bandHi: 10.5e9,
      analysisHz: 10e9,
      scopeState: 21,
      polarGain: 2,
    },

    limits: {
      rmsPhaseDeg: 5,
      peakPhaseDeg: 10,
      rmsAmpDb: 0.5,
      ilMaxDb: 4,
      vswrMax: 1.8,
    },

    mc: { runs: 100, freqPoints: 5 },

    methods: {
      recordLen: 256,
      cycles: 16,
      snrMin: 0,
      snrMax: 60,
      snrStep: 5,
      trials: 300,
      ratioDb: -6,
      deltaDeg: 50,
      adcBits: 12,
      harmonicOn: true,
      harmonicDbc: -40,
      harmonicOrder: 3,
      iqGainDb: 0.3,
      iqPhaseDeg: 1.5,
      spErrDeg: 1.5,
      spComp: 0.02,
      window: 'rect',
      biasSnrDb: 40,
      tableSnrDb: 30,
      seed: 7,
    },

    array: {
      elements: 16,
      spacing: 0.5,
      steerDeg: 25,
      freqHz: 10.5e9,
      taper: 'cospd',
      pedestal: 0.3,
    },
  };
}

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      merge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

export const PRESETS = {
  typical: {
    label: 'Типовой режим: 6 разрядов, полная калибровка',
    apply: {},
  },
  nocal: {
    label: 'Измерение без калибровки',
    apply: { sys: { cal: 'none' } },
  },
  response: {
    label: 'Нормировка по перемычке',
    apply: { sys: { cal: 'response' } },
  },
  lowPower: {
    label: 'Низкий уровень сигнала и широкая полоса ПЧ',
    apply: { sys: { powerDbm: -70, ifbwHz: 10000 } },
  },
  driftSeq: {
    label: 'Узкая полоса ПЧ и дрейф, последовательное измерение',
    apply: { sys: { ifbwHz: 10, driftDegMin: 0.1, strategy: 'sequential' } },
  },
  driftInt: {
    label: 'Узкая полоса ПЧ и дрейф, повторное опорное измерение',
    apply: { sys: { ifbwHz: 10, driftDegMin: 0.1, strategy: 'interleaved' } },
  },
  switched4: {
    label: '4 разряда на переключаемых линиях',
    apply: { dut: { bits: 4, topology: 'switched' }, sweep: { scopeState: 5 }, limits: { rmsPhaseDeg: 12, peakPhaseDeg: 25 } },
  },
  hplp5: {
    label: '5 разрядов на ФВЧ/ФНЧ',
    apply: { dut: { bits: 5, topology: 'hplp' }, sweep: { scopeState: 11 } },
  },
  ideal: {
    label: 'Идеальный тракт (проверка модели)',
    apply: {
      sys: {
        sources: { noise: false, quant: false, mismatch: false, leakage: false, tracking: false, drift: false },
      },
    },
  },
};

export function applyPreset(key) {
  const p = defaultParams();
  return merge(p, structuredClone(PRESETS[key].apply));
}

export function mergeParams(saved) {
  const base = defaultParams();
  if (!saved || typeof saved !== 'object') return base;
  const walk = (dst, src) => {
    for (const k of Object.keys(dst)) {
      if (src[k] === undefined) continue;
      if (dst[k] && typeof dst[k] === 'object') {
        if (src[k] && typeof src[k] === 'object') walk(dst[k], src[k]);
      } else if (typeof src[k] === typeof dst[k]) {
        dst[k] = src[k];
      }
    }
  };
  walk(base, saved);
  return base;
}

const isPow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

// Проверка ввода: ключ — путь параметра, значение — текст ошибки
export function validate(p) {
  const e = {};
  const num = (path, v, lo, hi, text) => {
    if (!Number.isFinite(v) || v < lo || v > hi) e[path] = text || `Допустимо от ${lo} до ${hi}`;
  };
  const int = (path, v, lo, hi) => {
    if (!Number.isInteger(v) || v < lo || v > hi) e[path] = `Целое число от ${lo} до ${hi}`;
  };

  int('dut.bits', p.dut.bits, 2, 6);
  num('dut.f0', p.dut.f0, 0.5e9, 40e9, 'Допустимо от 0,5 до 40 ГГц');
  num('dut.ron', p.dut.ron, 0, 20);
  num('dut.coffFf', p.dut.coffFf, 0, 200);
  num('dut.qL', p.dut.qL, 5, 1000);
  num('dut.qC', p.dut.qC, 5, 1000);
  num('dut.lineLossDb', p.dut.lineLossDb, 0, 5);
  num('dut.tolPct', p.dut.tolPct, 0, 10);
  int('dut.instance', p.dut.instance, 1, 100000);

  num('sys.powerDbm', p.sys.powerDbm, -90, 10);
  num('sys.nfDb', p.sys.nfDb, 0, 60);
  num('sys.ifbwHz', p.sys.ifbwHz, 1, 1e6, 'Допустимо от 1 Гц до 1 МГц');
  if (!isPow2(p.sys.recordLen) || p.sys.recordLen < 32 || p.sys.recordLen > 4096) {
    e['sys.recordLen'] = 'Степень двойки от 32 до 4096';
  }
  int('sys.adcBits', p.sys.adcBits, 6, 24);
  num('sys.headroomDb', p.sys.headroomDb, 0, 20);
  for (const k of ['esfDb', 'elfDb', 'edfDb', 'exfDb']) {
    num(`sys.res.${k}`, p.sys.res[k], -140, -10);
    num(`sys.raw.${k}`, p.sys.raw[k], -140, -3);
  }
  num('sys.res.trackDb', p.sys.res.trackDb, 0, 1);
  num('sys.res.trackDeg', p.sys.res.trackDeg, 0, 10);
  num('sys.raw.cableLossDb', p.sys.raw.cableLossDb, 0, 20);
  num('sys.raw.cableDelayNs', p.sys.raw.cableDelayNs, 0, 50);
  num('sys.driftDegMin', p.sys.driftDegMin, 0, 5);
  num('sys.driftDbMin', p.sys.driftDbMin, 0, 0.5);
  num('sys.settleUs', p.sys.settleUs, 0, 10000);
  num('sys.switchMs', p.sys.switchMs, 0, 1000);
  int('sys.seed', p.sys.seed, 0, 2 ** 31);

  num('sweep.start', p.sweep.start, 0.1e9, 60e9, 'Допустимо от 0,1 до 60 ГГц');
  num('sweep.stop', p.sweep.stop, 0.1e9, 60e9, 'Допустимо от 0,1 до 60 ГГц');
  if (!e['sweep.start'] && !e['sweep.stop'] && p.sweep.stop <= p.sweep.start) {
    e['sweep.stop'] = 'Верхняя частота должна быть больше нижней';
  }
  int('sweep.points', p.sweep.points, 3, 401);
  if (!(p.sweep.bandLo >= p.sweep.start - 1 && p.sweep.bandLo < p.sweep.bandHi)) {
    e['sweep.bandLo'] = 'Нижняя граница полосы — внутри диапазона и ниже верхней';
  }
  if (!(p.sweep.bandHi <= p.sweep.stop + 1 && p.sweep.bandHi > p.sweep.bandLo)) {
    e['sweep.bandHi'] = 'Верхняя граница полосы — внутри диапазона и выше нижней';
  }
  if (!(p.sweep.analysisHz >= p.sweep.start - 1 && p.sweep.analysisHz <= p.sweep.stop + 1)) {
    e['sweep.analysisHz'] = 'Частота анализа должна лежать в диапазоне развёртки';
  }
  int('sweep.scopeState', p.sweep.scopeState, 0, (1 << p.dut.bits) - 1);
  num('sweep.polarGain', p.sweep.polarGain, 1, 20);

  num('limits.rmsPhaseDeg', p.limits.rmsPhaseDeg, 0, 90);
  num('limits.peakPhaseDeg', p.limits.peakPhaseDeg, 0, 180);
  num('limits.rmsAmpDb', p.limits.rmsAmpDb, 0, 10);
  num('limits.ilMaxDb', p.limits.ilMaxDb, 0, 40);
  num('limits.vswrMax', p.limits.vswrMax, 1, 10);

  int('mc.runs', p.mc.runs, 10, 2000);
  int('mc.freqPoints', p.mc.freqPoints, 1, 21);

  const m = p.methods;
  int('methods.recordLen', m.recordLen, 32, 4096);
  if (!e['methods.recordLen'] && m.recordLen % 2) e['methods.recordLen'] = 'Чётное число от 32 до 4096';
  num('methods.cycles', m.cycles, 1, m.recordLen / 4, `Допустимо от 1 до ${m.recordLen / 4}`);
  num('methods.snrMin', m.snrMin, -20, 100);
  num('methods.snrMax', m.snrMax, -20, 100);
  if (!e['methods.snrMax'] && m.snrMax <= m.snrMin) e['methods.snrMax'] = 'Больше нижней границы';
  num('methods.snrStep', m.snrStep, 0.5, 20);
  int('methods.trials', m.trials, 20, 5000);
  num('methods.ratioDb', m.ratioDb, -40, 20);
  num('methods.deltaDeg', m.deltaDeg, -180, 360);
  int('methods.adcBits', m.adcBits, 4, 24);
  num('methods.harmonicDbc', m.harmonicDbc, -100, -10);
  int('methods.harmonicOrder', m.harmonicOrder, 2, 5);
  num('methods.iqGainDb', m.iqGainDb, -3, 3);
  num('methods.iqPhaseDeg', m.iqPhaseDeg, -20, 20);
  num('methods.spErrDeg', m.spErrDeg, -20, 20);
  num('methods.spComp', m.spComp, 0, 0.5);
  num('methods.biasSnrDb', m.biasSnrDb, -10, 100);
  num('methods.tableSnrDb', m.tableSnrDb, -20, 100);
  int('methods.seed', m.seed, 0, 2 ** 31);

  int('array.elements', p.array.elements, 2, 128);
  num('array.spacing', p.array.spacing, 0.1, 2);
  num('array.steerDeg', p.array.steerDeg, -80, 80);
  num('array.pedestal', p.array.pedestal, 0, 1);
  num('array.freqHz', p.array.freqHz, 0.1e9, 60e9, 'Допустимо от 0,1 до 60 ГГц');

  return { ok: Object.keys(e).length === 0, errors: e };
}
