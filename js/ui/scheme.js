// Структурная схема моделируемой измерительной системы с текущими значениями параметров (раздел 3 ТЗ)

import { fmt } from './chart.js';
import { CAL_MODES } from '../core/testset.js';

function block(x, y, w, h, title, sub, cls = '') {
  const lines = Array.isArray(title) ? title : [title];
  const cy = y + h / 2 - (sub ? 7 : 0) - ((lines.length - 1) * 14) / 2;
  let out = `<rect class="blk ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="7"/>`;
  lines.forEach((t, i) => {
    out += `<text x="${x + w / 2}" y="${cy + i * 14}" text-anchor="middle" dominant-baseline="middle">${t}</text>`;
  });
  if (sub) {
    out += `<text class="val" x="${x + w / 2}" y="${cy + lines.length * 14 + 1}" text-anchor="middle" dominant-baseline="middle">${sub}</text>`;
  }
  return out;
}

const wire = (d, ctl = false) => `<path class="wire${ctl ? ' ctl' : ''}" d="${d}" marker-end="url(#arr)"/>`;
const label = (x, y, t, anchor = 'middle') => `<text class="small" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;

export function schemeSvg(p, rec) {
  const ghz = (f) => fmt(f / 1e9, 1);
  const ifk = rec ? fmt(rec.ifHz / 1e3, rec.ifHz < 1e4 ? 2 : 1) : '—';
  const ifbw = p.sys.ifbwHz >= 1000 ? `${fmt(p.sys.ifbwHz / 1000, 0)} кГц` : `${fmt(p.sys.ifbwHz, 0)} Гц`;

  return `<svg viewBox="0 0 1000 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Структурная схема измерительной системы">
  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
  ${block(20, 30, 120, 54, 'Гетеродин', `ПЧ ${ifk} кГц`)}
  ${block(20, 130, 120, 54, 'Генератор СВЧ', `${fmt(p.sys.powerDbm, 0)} дБм, ${ghz(p.sweep.start)}…${ghz(p.sweep.stop)} ГГц`)}
  ${block(175, 30, 110, 54, 'Приёмник R', `АЦП ${p.sys.adcBits} разр.`)}
  ${block(320, 30, 110, 54, 'Приёмник A', 'отражённая волна')}
  ${block(175, 130, 110, 54, ['Ответвитель', 'опорного канала'])}
  ${block(320, 130, 110, 54, ['Направленный', 'ответвитель'])}
  ${block(470, 124, 150, 66, 'Фазовращатель', `${p.dut.bits} разр., ${2 ** p.dut.bits} состояний`, 'dut')}
  ${block(660, 130, 120, 54, 'Приёмник B', 'прошедшая волна')}
  ${block(470, 236, 150, 48, ['Контроллер', 'кода состояния'])}
  ${block(820, 30, 160, 54, 'ЦОС: ДПФ, B/R и A/R', `полоса ${ifbw}, ${p.sys.recordLen} отсч.`, 'dsp')}
  ${block(820, 130, 160, 54, 'Коррекция погрешностей', CAL_MODES[p.sys.cal].toLowerCase(), 'dsp')}
  ${block(820, 230, 160, 54, ['Расчёт параметров', 'и заключение'], null, 'dsp')}
  ${wire('M140,157 H175')}
  ${wire('M285,157 H320')}
  ${wire('M430,157 H470')}
  ${wire('M620,157 H660')}
  ${wire('M230,130 V84')}
  ${wire('M375,130 V84')}
  ${wire('M140,57 H175')}
  ${wire('M230,30 V14 H900 V30')}
  ${wire('M430,57 H820')}
  ${wire('M720,130 V104 H860 V84')}
  ${wire('M940,84 V130')}
  ${wire('M900,184 V230')}
  ${wire('M820,260 H620', true)}
  ${wire('M545,236 V190', true)}
  ${label(450, 150, 'порт 1')}
  ${label(640, 150, 'порт 2')}
  ${label(560, 22, 'комплексные амплитуды R, A, B')}
  ${label(720, 276, 'код k = 0…' + (2 ** p.dut.bits - 1))}
</svg>`;
}
