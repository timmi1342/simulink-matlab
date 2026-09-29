// Комплексная арифметика, матрицы передачи и S-параметры четырёхполюсников (раздел 2.1 ТЗ)

export const cx = (re, im = 0) => ({ re, im });
export const ONE = cx(1, 0);
export const ZERO = cx(0, 0);

export function add(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function sub(a, b) {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function mul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function div(a, b) {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export function inv(a) {
  return div(ONE, a);
}

export function scale(a, k) {
  return { re: a.re * k, im: a.im * k };
}

export function abs(a) {
  return Math.hypot(a.re, a.im);
}

export function arg(a) {
  return Math.atan2(a.im, a.re);
}

export function polar(r, theta) {
  return { re: r * Math.cos(theta), im: r * Math.sin(theta) };
}

// Матрица передачи (ABCD) четырёхполюсника
export function abcd(a, b, c, d) {
  return { a, b, c, d };
}

export function cascade(m, n) {
  return {
    a: add(mul(m.a, n.a), mul(m.b, n.c)),
    b: add(mul(m.a, n.b), mul(m.b, n.d)),
    c: add(mul(m.c, n.a), mul(m.d, n.c)),
    d: add(mul(m.c, n.b), mul(m.d, n.d)),
  };
}

export function chain(...mats) {
  let m = mats[0];
  for (let i = 1; i < mats.length; i++) m = cascade(m, mats[i]);
  return m;
}

export function seriesZ(z) {
  return abcd(ONE, z, ZERO, ONE);
}

export function shuntY(y) {
  return abcd(ONE, ZERO, y, ONE);
}

// Отрезок линии: волновое сопротивление zc, электрическая длина theta (рад), затухание alpha (Нп)
export function tline(zc, theta, alpha) {
  const ch = { re: Math.cosh(alpha) * Math.cos(theta), im: Math.sinh(alpha) * Math.sin(theta) };
  const sh = { re: Math.sinh(alpha) * Math.cos(theta), im: Math.cosh(alpha) * Math.sin(theta) };
  return abcd(ch, scale(sh, zc), scale(sh, 1 / zc), ch);
}

// Параллельное соединение четырёхполюсников: сложение матриц проводимостей
export function toY(m) {
  const det = sub(mul(m.a, m.d), mul(m.b, m.c));
  return {
    y11: div(m.d, m.b),
    y12: div(scale(det, -1), m.b),
    y21: div(cx(-1, 0), m.b),
    y22: div(m.a, m.b),
  };
}

export function fromY(y) {
  const det = sub(mul(y.y11, y.y22), mul(y.y12, y.y21));
  return abcd(
    div(scale(y.y22, -1), y.y21),
    div(cx(-1, 0), y.y21),
    div(scale(det, -1), y.y21),
    div(scale(y.y11, -1), y.y21),
  );
}

export function parallel(m, n) {
  const a = toY(m);
  const b = toY(n);
  return fromY({
    y11: add(a.y11, b.y11),
    y12: add(a.y12, b.y12),
    y21: add(a.y21, b.y21),
    y22: add(a.y22, b.y22),
  });
}

// Пересчёт матрицы передачи в S-параметры при опорном сопротивлении z0
export function toS(m, z0) {
  const bz = scale(m.b, 1 / z0);
  const cz = scale(m.c, z0);
  const den = add(add(m.a, bz), add(cz, m.d));
  const det = sub(mul(m.a, m.d), mul(m.b, m.c));
  return {
    s11: div(sub(add(m.a, bz), add(cz, m.d)), den),
    s12: div(scale(det, 2), den),
    s21: div(cx(2, 0), den),
    s22: div(sub(add(bz, m.d), add(cz, m.a)), den),
  };
}
