// Управление: параметры, вкладки, запуск расчётов, отрисовка, подсказки, экспорт (раздел 3 ТЗ)

import { defaultParams, validate, applyPreset, PRESETS, mergeParams } from './params.js';
import { runMeasurement, analyze, verdictTable, capturePoint } from './core/measure.js';
import { runMonteCarlo } from './core/montecarlo.js';
import { runMethods, METHODS } from './core/methods.js';
import { runArray, TAPERS, SCENARIOS } from './core/array.js';
import { TOPOLOGIES, KIND_NAMES, bitKind, bitShifts } from './core/dut.js';
import { CAL_MODES, STRATEGIES } from './core/testset.js';
import { fmt } from './ui/chart.js';
import * as V from './ui/views.js';
import { schemeSvg } from './ui/scheme.js';
import * as X from './ui/export.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const STORE = 'fvlab.state';
const TABS = ['stand', 'mc', 'methods', 'array'];

let state = defaultParams();
let tab = 'stand';
let autoRun = true;
let lightExport = true;
let visible = new Set(V.PLOTS.stand.map((p) => p.key));
const results = { stand: null, mc: null, methods: null, array: null };
const stale = { stand: true, mc: true, methods: true, array: true };
const running = { mc: false, methods: false };
const hovers = new Map();
let timer = 0;

// ---------- Параметры и хранение ----------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const leaf = keys.pop();
  keys.reduce((o, k) => o[k], obj)[leaf] = value;
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ params: state, tab, visible: [...visible], autoRun, lightExport }));
  } catch (e) { /* хранилище недоступно — работа продолжается без сохранения */ }
}

function restore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!d) return;
    state = mergeParams(d.params);
    if (TABS.includes(d.tab)) tab = d.tab;
    if (Array.isArray(d.visible) && d.visible.length) visible = new Set(d.visible);
    if (typeof d.autoRun === 'boolean') autoRun = d.autoRun;
    if (typeof d.lightExport === 'boolean') lightExport = d.lightExport;
  } catch (e) { /* повреждённые данные игнорируются */ }
}

function fillSelect(sel, entries) {
  sel.textContent = '';
  for (const [value, text] of entries) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }
}

function syncInputs(except) {
  for (const el of $$('[data-bind]')) {
    if (el === except) continue;
    const v = getPath(state, el.dataset.bind);
    const kind = el.dataset.kind;
    if (kind === 'bool') el.checked = !!v;
    else if (kind === 'string' || el.tagName === 'SELECT') el.value = String(v);
    else {
      const s = v / Number(el.dataset.scale || 1);
      el.value = Number.isFinite(s) ? String(+s.toFixed(6)) : '';
    }
  }
  const r = $('#analysisRange');
  r.min = String(state.sweep.start / 1e9);
  r.max = String(state.sweep.stop / 1e9);
  r.value = String(state.sweep.analysisHz / 1e9);
  updateTopologyHint();
}

function updateTopologyHint() {
  const groups = {};
  for (const s of bitShifts(state.dut.bits)) {
    const k = bitKind(state.dut.topology, s);
    (groups[k] ||= []).push(`${String(+s.toFixed(3)).replace('.', ',')}°`);
  }
  $('#topologyHint').textContent = Object.entries(groups)
    .map(([k, list]) => `${KIND_NAMES[k]}: ${list.join(', ')}`).join('; ');
}

function showErrors(errors) {
  for (const f of $$('.field.invalid')) {
    f.classList.remove('invalid');
    const box = f.querySelector('.error');
    if (box) box.textContent = '';
  }
  const keys = Object.keys(errors);
  for (const key of keys) {
    for (const el of $$(`[data-bind="${key}"]`)) {
      const f = el.closest('.field');
      if (!f) continue;
      f.classList.add('invalid');
      const box = f.querySelector('.error');
      if (box) box.textContent = errors[key];
      const group = f.closest('details');
      if (group) group.open = true;
    }
  }
  const banner = $('#banner');
  if (keys.length) {
    banner.hidden = false;
    banner.textContent = `Расчёт заблокирован: ошибок ввода — ${keys.length}. ${errors[keys[0]]}`;
  } else {
    banner.hidden = true;
  }
  $('#runBtn').disabled = keys.length > 0;
  return keys.length === 0;
}

function showFailure(prefix, err) {
  const banner = $('#banner');
  banner.hidden = false;
  banner.textContent = `${prefix}: ${err.message}`;
  console.error(err);
}

// Какие вкладки затрагивает изменение параметра
function affected(path) {
  if (path.startsWith('methods.')) return ['methods'];
  if (path.startsWith('array.')) return ['array'];
  if (path.startsWith('mc.')) return ['mc'];
  if (path.startsWith('limits.') || path === 'sweep.scopeState' || path === 'sweep.polarGain') return ['stand'];
  return ['stand', 'mc', 'array'];
}

function onChange(path) {
  for (const t of affected(path)) {
    stale[t] = true;
    if (t === 'mc' && results.mc) $('#mcStale').hidden = false;
    if (t === 'methods' && results.methods) $('#methodsStale').hidden = false;
  }
  const ok = showErrors(validate(state).errors);
  persist();
  if (!ok || !autoRun) return;
  clearTimeout(timer);
  timer = setTimeout(() => ensureTab(tab), 260);
}

// ---------- Графики ----------

function buildPlots(t) {
  const box = $(`#${t}Plots`);
  box.textContent = '';
  for (const pl of V.PLOTS[t]) {
    const sec = document.createElement('section');
    sec.className = `plot ${pl.cls || ''}`;
    sec.dataset.plot = pl.key;
    sec.dataset.tab = t;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', pl.label);
    const cross = document.createElement('div');
    cross.className = 'crosshair';
    cross.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'plot-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'PNG';
    btn.title = 'Сохранить рисунок PNG';
    btn.addEventListener('click', () => savePlotPng(t, pl));
    actions.appendChild(btn);
    sec.append(canvas, cross, actions);
    box.appendChild(sec);
  }
  applyVisibility();
}

function applyVisibility() {
  for (const sec of $$('#standPlots .plot')) sec.hidden = !visible.has(sec.dataset.plot);
}

function drawFor(t, key) {
  if (t === 'stand' && results.stand) return V.standDraw(key, { ...results.stand, mc: stale.mc ? null : results.mc });
  if (t === 'mc' && results.mc) return V.mcDraw(key, results.mc);
  if (t === 'methods' && results.methods) return V.methodsDraw(key, results.methods);
  if (t === 'array' && results.array) return V.arrayDraw(key, results.array, results.array.p);
  return null;
}

function drawTab(t) {
  for (const sec of $$(`#${t}Plots .plot`)) {
    if (sec.hidden) continue;
    const canvas = sec.querySelector('canvas');
    const draw = drawFor(t, sec.dataset.plot);
    if (!draw) continue;
    try {
      hovers.set(canvas, draw(canvas));
    } catch (err) {
      showFailure(`Ошибка построения графика «${sec.dataset.plot}»`, err);
    }
  }
}

function hideTip() {
  $('#tooltip').hidden = true;
  for (const c of $$('.crosshair')) c.hidden = true;
}

function onPointer(e) {
  const canvas = e.target;
  if (!(canvas instanceof HTMLCanvasElement)) return hideTip();
  const fn = hovers.get(canvas);
  if (!fn) return hideTip();
  const r = canvas.getBoundingClientRect();
  const info = fn(e.clientX - r.left, e.clientY - r.top);
  const cross = canvas.parentElement.querySelector('.crosshair');
  if (!info) {
    hideTip();
    return;
  }
  for (const c of $$('.crosshair')) if (c !== cross) c.hidden = true;
  if (info.cross !== undefined && info.cross !== null) {
    cross.hidden = false;
    cross.style.left = `${info.cross}px`;
  } else {
    cross.hidden = true;
  }
  const tip = $('#tooltip');
  tip.textContent = '';
  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = info.title;
  tip.appendChild(title);
  for (const row of info.rows) {
    const d = document.createElement('div');
    d.className = 'tt-row';
    const key = document.createElement('span');
    key.className = 'tt-key';
    key.style.background = row.color;
    const val = document.createElement('span');
    val.className = 'tt-val';
    val.textContent = row.value;
    const lab = document.createElement('span');
    lab.className = 'tt-lab';
    lab.textContent = row.label;
    d.append(key, val, lab);
    tip.appendChild(d);
  }
  tip.hidden = false;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 14;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - 14;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

// ---------- Вкладка «Измерительный стенд» ----------

function runStand() {
  if (!showErrors(validate(state).errors)) return;
  const p = structuredClone(state);
  const t0 = performance.now();
  try {
    const res = runMeasurement(p);
    const an = analyze(res, p);
    const k = Math.min(p.sweep.scopeState, res.nStates - 1);
    const cap = capturePoint(p, res, k, an.ai);
    results.stand = { p, res, an, cap, ms: performance.now() - t0 };
    stale.stand = false;
    renderStand();
  } catch (err) {
    showFailure('Ошибка расчёта', err);
  }
}

function timeText(s) {
  if (s < 1) return `${fmt(s * 1000, 0)} мс`;
  if (s < 120) return `${fmt(s, 1)} с`;
  return `${fmt(s / 60, 1)} мин`;
}

function renderStand() {
  const { p, res, an, ms } = results.stand;
  const rows = verdictTable(an, p.limits);
  V.renderVerdict($('#resultsBody'), rows);
  const checked = rows.filter((r) => !r.info);
  const ok = checked.every((r) => r.pass);
  const okTrue = checked.every((r) => r.truePass);
  const badge = $('#verdict');
  badge.textContent = ok ? 'годен' : 'не годен';
  badge.className = `verdict ${ok ? 'pass' : 'fail'}`;

  const dec = $('#decision');
  if (ok !== okTrue) {
    dec.hidden = false;
    dec.textContent = ok
      ? 'Ложная приёмка: по истинным параметрам фазовращатель не соответствует нормам, но погрешность измерения скрыла это.'
      : 'Ложная отбраковка: по истинным параметрам фазовращатель соответствует нормам, но погрешность измерения привела к заключению «не годен».';
  } else {
    dec.hidden = true;
  }

  const M = res.nStates;
  const nf = res.freqs.length;
  $('#standInfo').textContent = `${M} состояний × ${nf} частот, полоса ${fmt(p.sweep.bandLo / 1e9, 2)}–${fmt(p.sweep.bandHi / 1e9, 2)} ГГц`;
  $('#status').textContent = `стенд: расчёт ${fmt(ms, 0)} мс`;

  const tiles = [
    { label: 'Погрешность измерения фазы, наибольшая', value: `${fmt(an.acc.phaseMax, 3)}°`, note: 'в рабочей полосе по всем состояниям' },
    { label: 'СКО погрешности измерения фазы', value: `${fmt(an.acc.phaseRms, 3)}°`, note: 'измерено − истинное' },
    { label: 'Погрешность измерения потерь', value: `${fmt(an.acc.ilMax, 3)} дБ`, note: `среднее смещение ${fmt(an.acc.ilMean, 3)} дБ` },
    { label: 'Погрешность оценки СКО ошибки', value: `${fmt(an.acc.rmsMetric, 3)}°`, note: 'наибольшая в полосе' },
    { label: 'Отношение сигнал/шум', value: `${fmt(res.rec.snr0Db, 1)} дБ`, note: `в опорном канале, порог шума ${fmt(res.rec.floorDbm, 1)} дБм` },
    { label: 'Длительность цикла измерения', value: timeText(res.timing.total), note: `${res.timing.slots} развёрток по ${timeText(res.timing.tState)}` },
  ];
  V.renderTiles($('#accTiles'), tiles);
  $('#scheme').innerHTML = schemeSvg(p, res.rec);
  V.renderBits($('#bitsBody'), res, an);
  if (tab === 'stand') drawTab('stand');
}

// ---------- Вкладки экспериментов ----------

async function runMcTab() {
  if (running.mc || !showErrors(validate(state).errors)) return;
  running.mc = true;
  const btn = $('#mcRun');
  const bar = $('#mcProgress');
  btn.disabled = true;
  bar.hidden = false;
  bar.firstElementChild.style.width = '0%';
  for (const s of $$('#mcPlots .plot')) s.classList.add('busy');
  const t0 = performance.now();
  const p = structuredClone(state);
  try {
    const R = await runMonteCarlo(p, { onProgress: (x) => { bar.firstElementChild.style.width = `${(x * 100).toFixed(1)}%`; } });
    R.p = p;
    results.mc = R;
    stale.mc = false;
    $('#mcStale').hidden = true;
    V.renderMc($('#mcBody'), R);
    $('#mcInfo').textContent = `${R.runs} прогонов × ${R.freqs.length} частот × ${R.nStates} состояний, ${fmt((performance.now() - t0) / 1000, 1)} с`;
    if (tab === 'mc') drawTab('mc');
  } catch (err) {
    showFailure('Ошибка моделирования Монте-Карло', err);
  } finally {
    running.mc = false;
    btn.disabled = false;
    bar.hidden = true;
    for (const s of $$('#mcPlots .plot')) s.classList.remove('busy');
  }
}

async function runMethodsTab() {
  if (running.methods || !showErrors(validate(state).errors)) return;
  running.methods = true;
  const btn = $('#methodsRun');
  const bar = $('#methodsProgress');
  btn.disabled = true;
  bar.hidden = false;
  for (const s of $$('#methodsPlots .plot')) s.classList.add('busy');
  const t0 = performance.now();
  try {
    const R = await runMethods(structuredClone(state.methods), { onProgress: (x) => { bar.firstElementChild.style.width = `${(x * 100).toFixed(1)}%`; } });
    results.methods = R;
    stale.methods = false;
    $('#methodsStale').hidden = true;
    V.renderMethods($('#methodsBody'), R);
    $('#methodsInfo').textContent = `таблица при ОСШ ${fmt(R.tableSnr, 0)} дБ; ${state.methods.trials} испытаний на точку, ${fmt((performance.now() - t0) / 1000, 1)} с`;
    if (tab === 'methods') drawTab('methods');
  } catch (err) {
    showFailure('Ошибка эксперимента', err);
  } finally {
    running.methods = false;
    btn.disabled = false;
    bar.hidden = true;
    for (const s of $$('#methodsPlots .plot')) s.classList.remove('busy');
  }
}

function runArrayTab() {
  if (!showErrors(validate(state).errors)) return;
  const p = structuredClone(state);
  try {
    const t0 = performance.now();
    const R = runArray(p);
    R.p = p;
    results.array = R;
    stale.array = false;
    V.renderArray($('#arrayBody'), R);
    $('#arrayInfo').textContent = `шаг ${fmt(R.dl, 3)} λ на рабочей частоте; при точном измерении калибровка дала бы СКО фазы ${fmt(R.idealCalRms, 3)}°; ${fmt(performance.now() - t0, 0)} мс`;
    if (tab === 'array') drawTab('array');
  } catch (err) {
    showFailure('Ошибка расчёта решётки', err);
  }
}

function ensureTab(t) {
  if (t === 'stand' && stale.stand) return runStand();
  if (t === 'array' && stale.array) return runArrayTab();
  if (t === 'mc' && !results.mc) return runMcTab();
  if (t === 'methods' && !results.methods) return runMethodsTab();
  drawTab(t);
}

function setTab(t) {
  tab = t;
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false');
  for (const p of $$('.tab')) p.hidden = p.dataset.panel !== t;
  for (const g of $$('.group[data-tabs]')) g.hidden = !g.dataset.tabs.split(' ').includes(t);
  hideTip();
  persist();
  ensureTab(t);
}

// ---------- Экспорт ----------

function tabDraws(t) {
  const defs = V.PLOTS[t].filter((pl) => t !== 'stand' || visible.has(pl.key));
  return defs.map((pl) => drawFor(t, pl.key)).filter(Boolean);
}

async function savePlotPng(t, pl) {
  const draw = drawFor(t, pl.key);
  if (draw) await X.savePng(draw, pl.file, lightExport);
}

const TAB_CAPTIONS = {
  stand: 'измерительный стенд',
  mc: 'бюджет неопределённости',
  methods: 'сравнение методов измерения фазы',
  array: 'применение в ФАР',
};

function csvStand() {
  const { p, res, an } = results.stand;
  const nf = res.freqs.length;
  const rel = an.rel;
  const rows = [];
  for (let fi = 0; fi < nf; fi++) {
    for (let k = 0; k < res.nStates; k++) {
      const i = k * nf + fi;
      rows.push([res.freqs[fi] / 1e9, k, k * res.lsb, rel.phM[i], rel.phT[i], rel.errM[i], rel.errT[i],
        rel.ilM[i], rel.ilT[i], rel.vswrM[i], rel.vswrT[i]]);
    }
  }
  return X.makeCsv(
    [`PhaseShifter Lab: результаты измерения, ${X.dateText()}`,
      `Фазовращатель: ${p.dut.bits} разрядов, ${TOPOLOGIES[p.dut.topology]}, экземпляр ${p.dut.instance}`,
      `Калибровка: ${CAL_MODES[p.sys.cal]}; полоса ПЧ ${p.sys.ifbwHz} Гц; мощность ${p.sys.powerDbm} дБм`],
    ['f, ГГц', 'состояние', 'идеальный сдвиг, °', 'сдвиг измеренный, °', 'сдвиг истинный, °', 'ошибка измеренная, °',
      'ошибка истинная, °', 'потери измеренные, дБ', 'потери истинные, дБ', 'КСВН измеренный', 'КСВН истинный'],
    rows);
}

function csvMc() {
  const R = results.mc;
  const meta = [`PhaseShifter Lab: моделирование Монте-Карло, ${X.dateText()}`];
  for (const s of R.sources) {
    meta.push(s.enabled ? `${s.name}: u(φ) = ${s.u.phase} °, u(потерь) = ${s.u.il} дБ` : `${s.name}: отключён`);
  }
  meta.push(`Суммарная: u(φ) = ${R.total.phase} °, u(потерь) = ${R.total.il} дБ; истинное СКО ошибки ${R.histStats.rmsTrue} °`);
  return X.makeCsv(meta, ['прогон', 'СКО фазовой ошибки, °', 'пиковая ошибка, °', 'средние потери, дБ'],
    R.runRows.map((r) => [r.run, r.rmsCenter, r.peakCenter, r.ilMeanCenter]));
}

function csvMethods() {
  const R = results.methods;
  const header = ['ОСШ, дБ', 'граница К-Р, °', ...METHODS.map((m) => `СКП ${m.short}, °`), ...METHODS.map((m) => `смещение ${m.short}, °`)];
  const rows = R.snrs.map((s, i) => [s, R.crb[i], ...METHODS.map((m) => R.rms[m.key][i]), ...METHODS.map((m) => R.bias[m.key][i])]);
  return X.makeCsv([`PhaseShifter Lab: сравнение методов измерения фазы, ${X.dateText()}`], header, rows);
}

function csvArray() {
  const R = results.array;
  const header = ['угол, °', ...SCENARIOS.map((s) => `${s.name}, дБ`)];
  const rows = Array.from(R.angles, (a, i) => [a, ...SCENARIOS.map((s) => R.scenarios[s.key].db[i])]);
  const meta = [`PhaseShifter Lab: диаграмма направленности ФАР, ${X.dateText()}`];
  R.req.forEach((r, n) => {
    meta.push(`элемент ${n + 1}: требуемый сдвиг ${r.toFixed(3)}°, код по номиналу ${R.scenarios.nominal.code[n]}, ` +
      `код по калибровке ${R.scenarios.calib.code[n]}, ошибка ${R.scenarios.nominal.errs[n].toFixed(3)}° / ${R.scenarios.calib.errs[n].toFixed(3)}°`);
  });
  return X.makeCsv(meta, header, rows);
}

function reportInfo() {
  const { p, res, an } = results.stand;
  const rows = verdictTable(an, p.limits).map((r) => ({
    ...r,
    measText: r.bool ? (r.meas ? 'да' : 'нет') : `${fmt(r.meas, r.digits)} ${r.unit}`,
    trueText: r.bool ? (r.truth ? 'да' : 'нет') : `${fmt(r.truth, r.digits)} ${r.unit}`,
    limitText: r.bool ? r.limit : `${r.cmp} ${fmt(r.limit, 2)} ${r.unit}`,
  }));
  const checked = rows.filter((r) => !r.info);
  const ok = checked.every((r) => r.pass);
  const okTrue = checked.every((r) => r.truePass);
  const accRows = [
    ['Погрешность измерения фазы, наибольшая', `${fmt(an.acc.phaseMax, 3)}°`],
    ['СКО погрешности измерения фазы', `${fmt(an.acc.phaseRms, 3)}°`],
    ['Погрешность измерения потерь, наибольшая', `${fmt(an.acc.ilMax, 3)} дБ`],
    ['Погрешность оценки СКО фазовой ошибки', `${fmt(an.acc.rmsMetric, 3)}°`],
  ];
  if (results.mc && !stale.mc) {
    accRows.push(['Расширенная неопределённость фазы U (k = 2), Монте-Карло', `${fmt(2 * results.mc.total.phase, 4)}°`]);
  }
  return {
    dutRows: [
      ['Число разрядов / младший разряд', `${p.dut.bits} / ${fmt(res.lsb, 3)}°`],
      ['Схема построения', TOPOLOGIES[p.dut.topology]],
      ['Расчётная частота', `${fmt(p.dut.f0 / 1e9, 3)} ГГц`],
      ['Ключи: Ron / Coff', `${fmt(p.dut.ron, 2)} Ом / ${fmt(p.dut.coffFf, 1)} фФ`],
      ['Добротность L / C, потери в линиях', `${p.dut.qL} / ${p.dut.qC}, ${fmt(p.dut.lineLossDb, 2)} дБ/λ`],
      ['Разброс номиналов / экземпляр', `${fmt(p.dut.tolPct, 1)} % / № ${p.dut.instance}`],
    ],
    sysRows: [
      ['Мощность генератора / порог шума', `${fmt(p.sys.powerDbm, 0)} дБм / ${fmt(res.rec.floorDbm, 1)} дБм`],
      ['Полоса ПЧ / запись / АЦП', `${p.sys.ifbwHz} Гц / ${p.sys.recordLen} отсч. / ${p.sys.adcBits} разр.`],
      ['Калибровка', CAL_MODES[p.sys.cal]],
      ['Порядок измерения', STRATEGIES[p.sys.strategy]],
      ['Дрейф фазы / амплитуды', `${fmt(p.sys.driftDegMin, 3)} °/мин / ${fmt(p.sys.driftDbMin, 4)} дБ/мин`],
      ['Диапазон / рабочая полоса', `${fmt(p.sweep.start / 1e9, 2)}–${fmt(p.sweep.stop / 1e9, 2)} ГГц, ${p.sweep.points} точек / ${fmt(p.sweep.bandLo / 1e9, 2)}–${fmt(p.sweep.bandHi / 1e9, 2)} ГГц`],
      ['Длительность цикла измерения', timeText(res.timing.total)],
    ],
    rows,
    verdict: ok,
    falseDecision: ok === okTrue ? '' : (ok ? 'Внимание: ложная приёмка — истинные параметры вне норм.' : 'Внимание: ложная отбраковка — истинные параметры в пределах норм.'),
    accRows,
    notes: [
      'Разряды рассчитаны по формулам проектирования на расчётной частоте; ключ: открыт — Ron, закрыт — Coff.',
      'Измерение моделирует векторный анализатор: 12-членная модель ошибок, прямое направление.',
      'Относительный фазовый сдвиг отсчитывается от состояния 0; положительное значение — задержка.',
      'Шум задан коэффициентом шума и полосой ПЧ; квантование АЦП моделируется по отсчётам записи.',
      'Истинные параметры рассчитаны по модели фазовращателя без погрешностей измерения.',
    ],
  };
}

function busyButton(btn, fn) {
  return async () => {
    const text = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Подождите…';
    try {
      await fn();
    } catch (err) {
      showFailure('Ошибка экспорта', err);
    } finally {
      btn.disabled = false;
      btn.textContent = text;
    }
  };
}

// ---------- Инициализация ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#themeBtn').textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  try { localStorage.setItem('fvlab.theme', theme); } catch (e) { /* игнорируется */ }
  if (results.stand) $('#scheme').innerHTML = schemeSvg(results.stand.p, results.stand.res.rec);
  drawTab(tab);
  if (tab === 'methods' && results.methods) V.renderMethods($('#methodsBody'), results.methods);
  if (tab === 'array' && results.array) V.renderArray($('#arrayBody'), results.array);
}

function bind() {
  fillSelect($('#topology'), Object.entries(TOPOLOGIES));
  fillSelect($('#cal'), Object.entries(CAL_MODES));
  fillSelect($('#strategy'), Object.entries(STRATEGIES));
  fillSelect($('#taper'), Object.entries(TAPERS));
  fillSelect($('#preset'), [['', '— выберите режим —'], ...Object.entries(PRESETS).map(([k, v]) => [k, v.label])]);

  $('#preset').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state = applyPreset(e.target.value);
    syncInputs();
    for (const t of TABS) stale[t] = true;
    if (results.mc) $('#mcStale').hidden = false;
    onChange('preset');
  });

  for (const el of $$('[data-bind]')) {
    const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const kind = el.dataset.kind;
      let v;
      if (kind === 'bool') v = el.checked;
      else if (kind === 'string') v = el.value;
      else {
        v = Number(el.value) * Number(el.dataset.scale || 1);
        if (kind === 'int') v = Math.round(v);
      }
      setPath(state, el.dataset.bind, v);
      if (el.dataset.bind === 'dut.bits') {
        state.sweep.scopeState = Math.min(state.sweep.scopeState, 2 ** state.dut.bits - 1);
      }
      $('#preset').value = '';
      syncInputs(el);
      onChange(el.dataset.bind);
    });
  }

  for (const b of $$('.tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

  const chips = $('#chips');
  for (const pl of V.PLOTS.stand) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = pl.label;
    b.setAttribute('aria-pressed', visible.has(pl.key) ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (visible.has(pl.key)) visible.delete(pl.key);
      else visible.add(pl.key);
      b.setAttribute('aria-pressed', visible.has(pl.key) ? 'true' : 'false');
      applyVisibility();
      drawTab('stand');
      persist();
    });
    chips.appendChild(b);
  }

  $('#runBtn').addEventListener('click', () => {
    stale[tab] = true;
    if (tab === 'mc') runMcTab();
    else if (tab === 'methods') runMethodsTab();
    else ensureTab(tab);
  });
  $('#mcRun').addEventListener('click', runMcTab);
  $('#methodsRun').addEventListener('click', runMethodsTab);

  $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  $('#autoRun').checked = autoRun;
  $('#autoRun').addEventListener('change', (e) => {
    autoRun = e.target.checked;
    persist();
    if (autoRun) ensureTab(tab);
  });
  $('#lightExport').checked = lightExport;
  $('#lightExport').addEventListener('change', (e) => {
    lightExport = e.target.checked;
    persist();
  });

  const reportBtn = $('#reportBtn');
  reportBtn.addEventListener('click', busyButton(reportBtn, async () => {
    if (stale.stand) runStand();
    if (!results.stand) return;
    const pages = [X.reportPage(reportInfo()), ...X.plotPages(tabDraws('stand'), TAB_CAPTIONS.stand)];
    X.download(await X.makePdf(pages), `fv_protokol_${X.stamp()}.pdf`);
  }));

  const pdfBtn = $('#exportPdf');
  pdfBtn.addEventListener('click', busyButton(pdfBtn, async () => {
    const draws = tabDraws(tab);
    if (!draws.length) throw new Error('на вкладке нет рассчитанных графиков');
    X.download(await X.makePdf(X.plotPages(draws, TAB_CAPTIONS[tab])), `fv_grafiki_${tab}_${X.stamp()}.pdf`);
  }));

  $('#exportCsv').addEventListener('click', () => {
    const make = { stand: csvStand, mc: csvMc, methods: csvMethods, array: csvArray }[tab];
    if (!results[tab]) return showFailure('Экспорт', new Error('на вкладке нет рассчитанных данных'));
    X.download(make(), `fv_dannye_${tab}_${X.stamp()}.csv`);
  });

  $('#saveCfg').addEventListener('click', () => X.saveConfig(state));
  $('#loadCfgBtn').addEventListener('click', () => $('#loadCfg').click());
  $('#loadCfg').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state = mergeParams(await X.loadConfig(file));
      syncInputs();
      for (const t of TABS) stale[t] = true;
      onChange('config');
    } catch (err) {
      showFailure('Не удалось загрузить конфигурацию', err);
    } finally {
      e.target.value = '';
    }
  });
  $('#resetCfg').addEventListener('click', () => {
    state = defaultParams();
    $('#preset').value = '';
    syncInputs();
    for (const t of TABS) stale[t] = true;
    onChange('reset');
  });

  const main = $('#main');
  main.addEventListener('pointermove', onPointer);
  main.addEventListener('pointerleave', hideTip);
  main.addEventListener('scroll', hideTip, { passive: true });

  let rt = 0;
  new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => drawTab(tab), 120);
  }).observe(main);
}

function init() {
  restore();
  for (const t of TABS) buildPlots(t);
  bind();
  syncInputs();
  let theme = 'light';
  try {
    theme = localStorage.getItem('fvlab.theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch (e) { /* игнорируется */ }
  document.documentElement.dataset.theme = theme;
  $('#themeBtn').textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  showErrors(validate(state).errors);
  runStand();
  setTab(tab);
}

init();
