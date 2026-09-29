// Сверка вычислительного ядра веб-версии с эталонной моделью на Python/NumPy (раздел 5 ТЗ)

import { runMeasurement, analyze } from '../js/core/measure.js';
import { defaultParams } from '../js/params.js';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const $ = (s) => document.querySelector(s);

function deepMerge(dst, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') deepMerge(dst[k], v);
    else dst[k] = v;
  }
  return dst;
}

function jsCase(p) {
  const res = runMeasurement(p);
  const an = analyze(res, p);
  const nf = res.freqs.length;
  const M = res.nStates;
  return {
    sumT: an.sumT,
    sumM: an.sumM,
    acc: an.acc,
    rmsT: Array.from(an.T.rms),
    rmsM: Array.from(an.M.rms),
    ilMeanM: Array.from(an.M.ilMean),
    phM_analysis: Array.from({ length: M }, (_, k) => an.rel.phM[k * nf + an.ai]),
    vswrM_analysis: Array.from({ length: M }, (_, k) => an.rel.vswrM[k * nf + an.ai]),
    timingTotal: res.timing.total,
    snr0Db: res.rec.snr0Db,
  };
}

function flatten(obj, prefix = '', out = []) {
  if (Array.isArray(obj)) obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out.push([prefix, obj]);
  return out;
}

function compareCase(js, py) {
  const a = new Map(flatten(js));
  const b = flatten(py);
  let maxAbs = 0, maxRel = 0, worst = '', mismatch = 0, count = 0;
  for (const [path, pv] of b) {
    const jv = a.get(path);
    count++;
    if (typeof pv === 'boolean' || typeof jv === 'boolean') {
      if (pv !== jv) mismatch++;
      continue;
    }
    const d = Math.abs(jv - pv);
    if (!(d <= 1e-9 + 1e-9 * Math.abs(pv))) mismatch++;
    if (d > maxAbs) maxAbs = d;
    if (Math.abs(pv) > 1e-6 && d / Math.abs(pv) > maxRel) {
      maxRel = d / Math.abs(pv);
      worst = path;
    }
  }
  return { count, maxAbs, maxRel, worst, mismatch };
}

function fmtE(v) {
  return v === 0 ? '0' : v.toExponential(2).replace('.', ',');
}

function render(spec, js, py, engine) {
  const body = $('#out');
  body.textContent = '';
  let all = true;
  let total = 0;
  let globalRel = 0;
  for (const c of spec.cases) {
    const r = compareCase(js[c.name], py[c.name]);
    total += r.count;
    globalRel = Math.max(globalRel, r.maxRel);
    const ok = r.mismatch === 0;
    if (!ok) all = false;
    const tr = document.createElement('tr');
    const cells = [
      [ok ? '✓ совпадает' : `✕ расхождений: ${r.mismatch}`, ok ? 'ok' : 'fail'],
      [c.title, ''],
      [String(r.count), 'num'],
      [fmtE(r.maxAbs), 'num'],
      [fmtE(r.maxRel), 'num'],
      [r.worst, 'detail'],
      [js[c.name].sumM.rmsPhase.toFixed(4).replace('.', ','), 'num'],
      [py[c.name].sumM.rmsPhase.toFixed(4).replace('.', ','), 'num'],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  $('#summary').textContent = all
    ? `Все ${spec.cases.length} режимов совпадают: ${total} значений, наибольшее относительное расхождение ${fmtE(globalRel)}.`
    : 'Обнаружены расхождения — см. таблицу.';
  $('#summary').className = all ? 'ok' : 'fail';
  $('#engine').textContent = `Эталон: ${engine}. Веб-версия: ${navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/)?.[0] || 'браузер'}.`;
}

async function main() {
  const spec = await (await fetch('cases.json')).json();
  const defaultsMatch = JSON.stringify(spec.defaults) === JSON.stringify(defaultParams());
  $('#defaults').textContent = defaultsMatch
    ? 'Параметры по умолчанию в cases.json совпадают с параметрами программы.'
    : 'Внимание: параметры по умолчанию в cases.json отличаются от параметров программы.';

  const t0 = performance.now();
  const js = {};
  for (const c of spec.cases) js[c.name] = jsCase(deepMerge(structuredClone(spec.defaults), c.patch || {}));
  $('#jsTime').textContent = `Веб-версия рассчитала ${spec.cases.length} режимов за ${((performance.now() - t0) / 1000).toFixed(2)} с.`;
  window.__js = js;

  try {
    const pre = await fetch('python_results.json');
    if (pre.ok) {
      const data = await pre.json();
      render(spec, js, data.cases, `${data.engine} (результаты, сохранённые командой python model.py --json)`);
      window.__compare = 'saved';
    }
  } catch (e) { /* файла с сохранёнными результатами нет */ }

  $('#pyBtn').addEventListener('click', async () => {
    const btn = $('#pyBtn');
    btn.disabled = true;
    const status = $('#pyStatus');
    try {
      status.textContent = 'Загрузка Python (Pyodide) и NumPy…';
      if (!window.loadPyodide) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = `${PYODIDE}pyodide.js`;
          s.onload = resolve;
          s.onerror = () => reject(new Error('не удалось загрузить Pyodide'));
          document.head.appendChild(s);
        });
      }
      const pyodide = await window.loadPyodide({ indexURL: PYODIDE });
      await pyodide.loadPackage('numpy');
      status.textContent = 'Расчёт эталонной модели…';
      const code = await (await fetch('model.py')).text();
      pyodide.runPython(code.replace(/if __name__ == "__main__":[\s\S]*$/, ''));
      const t1 = performance.now();
      const text = pyodide.globals.get('run_cases_json')(JSON.stringify(spec));
      const data = JSON.parse(text);
      status.textContent = `Эталонная модель выполнена в браузере за ${((performance.now() - t1) / 1000).toFixed(1)} с.`;
      render(spec, js, data.cases, `${data.engine}, выполнено в браузере через Pyodide`);
      window.__compare = 'pyodide';
    } catch (err) {
      status.textContent = `Ошибка: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

main();
