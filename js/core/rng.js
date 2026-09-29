// Генераторы псевдослучайных чисел с независимыми потоками (раздел 2.2 ТЗ)
//
// Каждая точка измерения получает собственный поток, зерно которого вычисляется
// хешированием номера прогона, состояния, частоты и канала. Поэтому результат
// не зависит от порядка вычислений и точно воспроизводится эталонной моделью.

export const SID = {
  dut: 101,
  terms: 202,
  point: 303,
  methods: 404,
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mix32(x) {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function streamSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) h = mix32((h ^ (p >>> 0)) + 0x9e3779b9);
  return h;
}

export function stream(...parts) {
  return mulberry32(streamSeed(...parts));
}

// Пара независимых нормальных величин (преобразование Бокса — Мюллера)
export function gaussianPair(rand) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const mag = Math.sqrt(-2 * Math.log(u1));
  return [mag * Math.cos(2 * Math.PI * u2), mag * Math.sin(2 * Math.PI * u2)];
}
