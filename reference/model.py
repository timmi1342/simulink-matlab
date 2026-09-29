# Эталонная модель системы измерения параметров фазовращателей на Python/NumPy (раздел 5 ТЗ)
#
# Модель повторяет вычислительное ядро веб-версии независимой реализацией, включая генератор
# псевдослучайных чисел и порядок арифметических операций, поэтому результаты сравниваются
# поразрядно, а не статистически.
#
#   python model.py           таблица результатов по режимам из cases.json
#   python model.py --json    те же результаты в формате JSON (сохраняются в python_results.json)

import json
import math
import os
import sys

import numpy as np

M32 = 0xFFFFFFFF
MASK = np.uint64(M32)
SID_DUT, SID_TERMS, SID_POINT = 101, 202, 303
Z0 = 50.0
REF_LINE_DEG = 20.0
NP_PER_DB = math.log(10) / 20
DEG = 180 / math.pi
KT_DBM_HZ = -174


# ---------- генератор псевдослучайных чисел ----------

def u32(x):
    return x & M32


def imul(a, b):
    return (u32(a) * u32(b)) & M32


def mix32(x):
    x = u32(x)
    x ^= x >> 16
    x = imul(x, 0x7FEB352D)
    x ^= x >> 15
    x = imul(x, 0x846CA68B)
    x ^= x >> 16
    return x


def stream_seed(*parts):
    h = 0x811C9DC5
    for p in parts:
        h = mix32(u32((h ^ u32(p)) + 0x9E3779B9))
    return h


class Stream:
    """Генератор mulberry32: n-е состояние равно seed + n·0x6D2B79F5, что позволяет
    вычислять сразу много значений средствами NumPy без потери поразрядного совпадения."""

    def __init__(self, *parts):
        self.a = stream_seed(*parts)
        self.n = 0

    def take(self, count):
        idx = np.arange(self.n + 1, self.n + count + 1, dtype=np.uint64)
        self.n += count
        t = (np.uint64(self.a) + idx * np.uint64(0x6D2B79F5)) & MASK
        t = ((t ^ (t >> np.uint64(15))) * (t | np.uint64(1))) & MASK
        t = t ^ ((t + (((t ^ (t >> np.uint64(7))) * (t | np.uint64(61))) & MASK)) & MASK)
        return ((t ^ (t >> np.uint64(14))) & MASK).astype(np.float64) / 4294967296.0

    def next(self):
        return float(self.take(1)[0])


def gaussian_pairs(u):
    u1 = np.maximum(u[0::2], 1e-12)
    u2 = u[1::2]
    mag = np.sqrt(-2 * np.log(u1))
    g = np.empty(len(u))
    g[0::2] = mag * np.cos(2 * math.pi * u2)
    g[1::2] = mag * np.sin(2 * math.pi * u2)
    return g


# ---------- комплексная арифметика в том же порядке операций, что и в веб-версии ----------

def cx(re, im=0.0):
    return (float(re), float(im))


ONE = cx(1.0)
ZERO = cx(0.0)


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def mul(a, b):
    return (a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0])


def div(a, b):
    d = b[0] * b[0] + b[1] * b[1]
    return ((a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d)


def inv(a):
    return div(ONE, a)


def scale(a, k):
    return (a[0] * k, a[1] * k)


def cabs(a):
    return math.hypot(a[0], a[1])


def carg(a):
    return math.atan2(a[1], a[0])


def polar(r, th):
    return (r * math.cos(th), r * math.sin(th))


def cascade(m, n):
    a, b, c, d = m
    e, f, g, h = n
    return (add(mul(a, e), mul(b, g)), add(mul(a, f), mul(b, h)),
            add(mul(c, e), mul(d, g)), add(mul(c, f), mul(d, h)))


def chain(*mats):
    m = mats[0]
    for n in mats[1:]:
        m = cascade(m, n)
    return m


def series_z(z):
    return (ONE, z, ZERO, ONE)


def shunt_y(y):
    return (ONE, ZERO, y, ONE)


def tline(zc, theta, alpha):
    ch = (math.cosh(alpha) * math.cos(theta), math.sinh(alpha) * math.sin(theta))
    sh = (math.sinh(alpha) * math.cos(theta), math.cosh(alpha) * math.sin(theta))
    return (ch, scale(sh, zc), scale(sh, 1 / zc), ch)


def to_y(m):
    a, b, c, d = m
    det = sub(mul(a, d), mul(b, c))
    return (div(d, b), div(scale(det, -1), b), div(cx(-1.0), b), div(a, b))


def from_y(y):
    y11, y12, y21, y22 = y
    det = sub(mul(y11, y22), mul(y12, y21))
    return (div(scale(y22, -1), y21), div(cx(-1.0), y21), div(scale(det, -1), y21), div(scale(y11, -1), y21))


def parallel(m, n):
    a = to_y(m)
    b = to_y(n)
    return from_y(tuple(add(a[i], b[i]) for i in range(4)))


def to_s(m, z0):
    a, b, c, d = m
    bz = scale(b, 1 / z0)
    cz = scale(c, z0)
    den = add(add(a, bz), add(cz, d))
    det = sub(mul(a, d), mul(b, c))
    return {
        "s11": div(sub(add(a, bz), add(cz, d)), den),
        "s12": div(scale(det, 2), den),
        "s21": div(cx(2.0), den),
        "s22": div(sub(add(bz, d), add(cz, a)), den),
    }


# ---------- объект измерения ----------

def bit_kind(topology, shift):
    if topology == "switched":
        return "switched"
    if topology == "hplp":
        return "hplp"
    return "hplp" if shift >= 90 else "loaded"


def design_dut(d):
    n_bits = d["bits"]
    w0 = 2 * math.pi * d["f0"]
    tol = d["tolPct"] / 100
    coff = d["coffFf"] * 1e-15
    bits = []
    for i in range(n_bits):
        shift = 180 / 2 ** i
        u = Stream(SID_DUT, d["instance"], i).take(8)
        g = gaussian_pairs(u)
        dev = lambda j: 1 + tol * float(g[j])
        kind = bit_kind(d["topology"], shift)
        phi = (shift * math.pi) / 180
        bit = {"index": i, "shift": shift, "kind": kind, "ron": d["ron"] * dev(4), "coff": coff * dev(5)}
        if kind == "switched":
            bit["thRef"] = ((REF_LINE_DEG * math.pi) / 180) * dev(0)
            bit["thDel"] = (((REF_LINE_DEG + shift) * math.pi) / 180) * dev(1)
            bit["zRef"] = Z0 * dev(2)
            bit["zDel"] = Z0 * dev(3)
        elif kind == "hplp":
            psi = phi / 2
            bit["lpL"] = ((Z0 * math.tan(psi / 2)) / w0) * dev(0)
            bit["lpC"] = (math.sin(psi) / (Z0 * w0)) * dev(1)
            bit["hpC"] = (1 / (w0 * Z0 * math.tan(psi / 2))) * dev(2)
            bit["hpL"] = (Z0 / (w0 * math.sin(psi))) * dev(3)
        else:
            dB = math.tan(phi / 2) / Z0
            a = (2 * dB) / w0
            cap = (a + math.sqrt(a * a + 4 * a * coff)) / 2
            b1 = w0 * cap
            b2 = (w0 * cap * coff) / (cap + coff) if coff > 0 else 0.0
            z_inv = Z0 * math.cos(phi / 2)
            th = math.acos(((b1 + b2) / 2) * z_inv)
            bit["capC"] = cap * dev(0)
            bit["zc"] = (z_inv / math.sin(th)) * dev(2)
            bit["th"] = th * dev(3)
        bits.append(bit)
    return {"nBits": n_bits, "nStates": 1 << n_bits, "lsb": 360 / (1 << n_bits), "f0": d["f0"],
            "qL": d["qL"], "qC": d["qC"], "lineLossDb": d["lineLossDb"], "bits": bits}


def z_ind(L, w, q):
    return ((w * L) / q, w * L)


def y_cap(C, w, q):
    return ((w * C) / q, w * C)


def line_alpha(dut, theta0, f):
    return dut["lineLossDb"] * (theta0 / (2 * math.pi)) * math.sqrt(f / dut["f0"]) * NP_PER_DB


def switch_z(bit, w, on):
    if on:
        return cx(bit["ron"]), False
    if not bit["coff"] > 0:
        return None, True
    return cx(0.0, -1 / (w * bit["coff"])), False


def bit_path(dut, bit, f, delay):
    w = 2 * math.pi * f
    r = f / dut["f0"]
    if bit["kind"] == "switched":
        th = bit["thDel"] if delay else bit["thRef"]
        zc = bit["zDel"] if delay else bit["zRef"]
        return tline(zc, th * r, line_alpha(dut, th, f))
    if delay:
        zs = z_ind(bit["lpL"], w, dut["qL"])
        return chain(series_z(zs), shunt_y(y_cap(bit["lpC"], w, dut["qC"])), series_z(zs))
    zs = inv(y_cap(bit["hpC"], w, dut["qC"]))
    return chain(series_z(zs), shunt_y(inv(z_ind(bit["hpL"], w, dut["qL"]))), series_z(zs))


def bit_matrix(dut, bit, f, on):
    w = 2 * math.pi * f
    r = f / dut["f0"]
    z_on, _ = switch_z(bit, w, True)
    z_off, off_open = switch_z(bit, w, False)
    if bit["kind"] == "loaded":
        zC = inv(y_cap(bit["capC"], w, dut["qC"]))
        z, is_open = (z_on, False) if on else (z_off, off_open)
        y = ZERO if is_open else inv(add(z, zC))
        line = tline(bit["zc"], bit["th"] * r, line_alpha(dut, bit["th"], f))
        return chain(shunt_y(y), line, shunt_y(y))
    m = chain(series_z(z_on), bit_path(dut, bit, f, on), series_z(z_on))
    if not off_open:
        m = parallel(m, chain(series_z(z_off), bit_path(dut, bit, f, not on), series_z(z_off)))
    return m


def true_sweep(dut, freqs):
    M = dut["nStates"]
    out = {}
    for fi, f in enumerate(freqs):
        mats = [(bit_matrix(dut, b, f, False), bit_matrix(dut, b, f, True)) for b in dut["bits"]]
        for k in range(M):
            m = mats[0][(k >> (dut["nBits"] - 1)) & 1]
            for i in range(1, dut["nBits"]):
                m = cascade(m, mats[i][(k >> (dut["nBits"] - 1 - i)) & 1])
            out[(k, fi)] = to_s(m, Z0)
    return out


# ---------- измерительная система ----------

RESIDUAL = {
    "none": dict(edf=False, esf=False, elf=False, exf=False, etf=False, erf=False),
    "response": dict(edf=False, esf=False, elf=False, exf=False, etf=True, erf=True),
    "full": dict(edf=True, esf=True, elf=True, exf=True, etf=True, erf=True),
}
TERM = dict(edf=1, esf=2, elf=3, exf=4, etf=5, erf=6, drift=7)


def db_to_lin(x):
    return 10 ** (x / 20)


def make_test_set(sys_, run, sources):
    resid = RESIDUAL[sys_["cal"]]

    def draw(tid):
        s = Stream(SID_TERMS, sys_["seed"], run, tid)
        return s.next(), s.next()

    def small(name):
        u1, u2 = draw(TERM[name])
        level = sys_["res"][name + "Db"] if resid[name] else sys_["raw"][name + "Db"]
        return {"mag": db_to_lin(level), "phase": 2 * math.pi * u1, "tau": (0.2 + 1.3 * u2) * 1e-9}

    def tracking(name, paths):
        u1, u2 = draw(TERM[name])
        if resid[name]:
            return {"mag": db_to_lin((2 * u1 - 1) * sys_["res"]["trackDb"]),
                    "phase": ((2 * u2 - 1) * sys_["res"]["trackDeg"] * math.pi) / 180, "tau": 0.0}
        return {"mag": db_to_lin(-paths * sys_["raw"]["cableLossDb"]), "phase": 2 * math.pi * u1,
                "tau": paths * sys_["raw"]["cableDelayNs"] * 1e-9}

    t = {"edf": small("edf"), "esf": small("esf"), "elf": small("elf"), "exf": small("exf"),
         "etf": tracking("etf", 1), "erf": tracking("erf", 2)}
    if not sources["mismatch"]:
        t["esf"]["mag"] = 0.0
        t["elf"]["mag"] = 0.0
    if not sources["leakage"]:
        t["edf"]["mag"] = 0.0
        t["exf"]["mag"] = 0.0
    if not sources["tracking"]:
        t["etf"] = {"mag": 1.0, "phase": 0.0, "tau": 0.0}
        t["erf"] = {"mag": 1.0, "phase": 0.0, "tau": 0.0}
    d1, d2 = draw(TERM["drift"])
    drift_deg = sys_["driftDegMin"] if run == 0 else (2 * d1 - 1) * sys_["driftDegMin"]
    drift_db = sys_["driftDbMin"] if run == 0 else (2 * d2 - 1) * sys_["driftDbMin"]
    if not sources["drift"]:
        drift_deg = drift_db = 0.0

    def val(term, f):
        return polar(term["mag"], term["phase"] - 2 * math.pi * f * term["tau"])

    def at(f, time):
        minutes = time / 60
        drift = polar(db_to_lin(drift_db * minutes), (-drift_deg * minutes * math.pi) / 180)
        return {"edf": val(t["edf"], f), "esf": val(t["esf"], f), "elf": val(t["elf"], f),
                "exf": val(t["exf"], f), "etf": mul(val(t["etf"], f), drift), "erf": mul(val(t["erf"], f), drift)}

    return at


def apply_errors(E, s):
    s11, s21, s12, s22 = s["s11"], s["s21"], s["s12"], s["s22"]
    delta = sub(mul(s11, s22), mul(s12, s21))
    den = add(sub(sub(cx(1.0), mul(E["esf"], s11)), mul(E["elf"], s22)), mul(mul(E["esf"], E["elf"]), delta))
    return (add(E["exf"], div(mul(E["etf"], s21), den)),
            add(E["edf"], div(mul(E["erf"], sub(s11, mul(E["elf"], delta))), den)))


def timing(sys_, sweep, n_states):
    t_point = 1 / sys_["ifbwHz"] + sys_["settleUs"] * 1e-6
    t_state = sweep["points"] * t_point + sys_["switchMs"] * 1e-3
    slots = max(1, 2 * (n_states - 1)) if sys_["strategy"] == "interleaved" else n_states
    return {"tPoint": t_point, "tState": t_state, "total": slots * t_state}


def point_time(sys_, sweep, tm, k, f, is_ref):
    span = sweep["stop"] - sweep["start"]
    pos = ((sweep["points"] - 1) * (f - sweep["start"])) / span if span > 0 else 0.0
    within = pos * tm["tPoint"]
    if sys_["strategy"] == "interleaved":
        if k == 0:
            return within
        return (2 * (k - 1) if is_ref else 2 * k - 1) * tm["tState"] + within
    return k * tm["tState"] + within


class Receiver:
    def __init__(self, sys_, sources):
        M = sys_["recordLen"]
        self.M = M
        k0 = max(2, M // 16)
        n = np.arange(M, dtype=np.float64)
        th = (2 * math.pi * k0 * n) / M
        self.cos = np.cos(th)
        self.sin = np.sin(th)
        floor = KT_DBM_HZ + sys_["nfDb"] + 10 * math.log10(sys_["ifbwHz"])
        self.snr0_db = sys_["powerDbm"] - floor
        snr0 = 10 ** (self.snr0_db / 10)
        self.sigma = math.sqrt(M / (4 * snr0)) if sources["noise"] else 0.0
        full = 10 ** (sys_["headroomDb"] / 20)
        self.half = 2 ** (sys_["adcBits"] - 1)
        self.q = (2 * full) / 2 ** sys_["adcBits"]
        self.quant = bool(sources["quant"])

    def channel(self, v, rand):
        x = v[0] * self.cos - v[1] * self.sin
        if self.sigma > 0:
            u = rand.take(self.M)
            u1 = np.maximum(u[0::2], 1e-12)
            mag = self.sigma * np.sqrt(-2 * np.log(u1))
            g = np.empty(self.M)
            g[0::2] = mag * np.cos(2 * math.pi * u[1::2])
            g[1::2] = mag * np.sin(2 * math.pi * u[1::2])
            x = x + g
        if self.quant:
            k = np.clip(np.floor(x / self.q + 0.5), -self.half, self.half - 1)
            x = k * self.q
        p = x[0::2] * self.cos[0::2] + x[1::2] * self.cos[1::2]
        q = x[0::2] * self.sin[0::2] + x[1::2] * self.sin[1::2]
        return (float(np.cumsum(p)[-1]), -float(np.cumsum(q)[-1]))

    def measure(self, s21m, s11m, rand):
        rot = polar(1.0, 2 * math.pi * rand.next())
        R = self.channel(rot, rand)
        B = self.channel(mul(s21m, rot), rand)
        A = self.channel(mul(s11m, rot), rand)
        return div(B, R), div(A, R)


def linspace(a, b, n):
    if n == 1:
        return [a]
    return [a + ((b - a) * i) / (n - 1) for i in range(n)]


def run_measurement(p, run=0):
    freqs = linspace(p["sweep"]["start"], p["sweep"]["stop"], p["sweep"]["points"])
    dut = design_dut(p["dut"])
    ts = true_sweep(dut, freqs)
    sys_ = p["sys"]
    at = make_test_set(sys_, run, sys_["sources"])
    rec = Receiver(sys_, sys_["sources"])
    tm = timing(sys_, p["sweep"], dut["nStates"])
    inst = p["dut"]["instance"]
    meas, refs = {}, {}
    for k in range(dut["nStates"]):
        for fi, f in enumerate(freqs):
            E = at(f, point_time(sys_, p["sweep"], tm, k, f, False))
            s21, s11 = apply_errors(E, ts[(k, fi)])
            meas[(k, fi)] = rec.measure(s21, s11, Stream(SID_POINT, sys_["seed"], run, inst, k, fi, 0))
            if sys_["strategy"] == "interleaved" and k >= 2:
                E = at(f, point_time(sys_, p["sweep"], tm, k, f, True))
                s21, s11 = apply_errors(E, ts[(0, fi)])
                refs[(k, fi)] = rec.measure(s21, s11, Stream(SID_POINT, sys_["seed"], run, inst, k, fi, 1))[0]
    return {"freqs": freqs, "dut": dut, "ts": ts, "meas": meas, "refs": refs, "timing": tm, "rec": rec}


# ---------- расчёт параметров ----------

def wrap180(x):
    return x - 360 * math.floor((x + 180) / 360)


def vswr(g):
    r = min(g, 0.999)
    return (1 + r) / (1 - r)


def analyze(res, p):
    dut, freqs, ts, meas = res["dut"], res["freqs"], res["ts"], res["meas"]
    M, nf, lsb = dut["nStates"], len(freqs), dut["lsb"]
    rel = {key: {} for key in ("phT", "phM", "errT", "errM", "ilT", "ilM", "vswrT", "vswrM")}
    for fi in range(nf):
        s0t, s0m = ts[(0, fi)]["s21"], meas[(0, fi)][0]
        for k in range(M):
            st, sm = ts[(k, fi)]["s21"], meas[(k, fi)][0]
            ideal = k * lsb
            ref = res["refs"][(k, fi)] if (p["sys"]["strategy"] == "interleaved" and k >= 2) else s0m
            eT = 0.0 if k == 0 else wrap180(carg(div(s0t, st)) * DEG - ideal)
            eM = 0.0 if k == 0 else wrap180(carg(div(ref, sm)) * DEG - ideal)
            rel["errT"][(k, fi)], rel["errM"][(k, fi)] = eT, eM
            rel["phT"][(k, fi)], rel["phM"][(k, fi)] = ideal + eT, ideal + eM
            rel["ilT"][(k, fi)] = -20 * math.log10(cabs(st))
            rel["ilM"][(k, fi)] = -20 * math.log10(cabs(sm))
            rel["vswrT"][(k, fi)] = vswr(cabs(ts[(k, fi)]["s11"]))
            rel["vswrM"][(k, fi)] = vswr(cabs(meas[(k, fi)][1]))

    def fmetrics(w):
        out = {key: [] for key in ("rms", "peak", "rmsAmp", "ilMean", "ilMax", "ilMin", "vswrMax", "mono")}
        for fi in range(nf):
            s2, pk = 0.0, 0.0
            for k in range(1, M):
                e = rel["err" + w][(k, fi)]
                s2 += e * e
                pk = max(pk, abs(e))
            s, mx, mn, vmax = 0.0, -math.inf, math.inf, 0.0
            for k in range(M):
                v = rel["il" + w][(k, fi)]
                s += v
                mx, mn = max(mx, v), min(mn, v)
                vmax = max(vmax, rel["vswr" + w][(k, fi)])
            mean = s / M
            sa = 0.0
            for k in range(M):
                d = rel["il" + w][(k, fi)] - mean
                sa += d * d
            mono = all(rel["ph" + w][(k + 1, fi)] - rel["ph" + w][(k, fi)] > 0 for k in range(M - 1))
            out["rms"].append(math.sqrt(s2 / (M - 1)))
            out["peak"].append(pk)
            out["rmsAmp"].append(math.sqrt(sa / M))
            out["ilMean"].append(mean)
            out["ilMax"].append(mx)
            out["ilMin"].append(mn)
            out["vswrMax"].append(vmax)
            out["mono"].append(mono)
        return out

    T, Mm = fmetrics("T"), fmetrics("M")
    lo, hi = p["sweep"]["bandLo"], p["sweep"]["bandHi"]
    band = [i for i, f in enumerate(freqs) if lo - 1 <= f <= hi + 1]
    if not band:
        c = (lo + hi) / 2
        band = [min(range(nf), key=lambda i: abs(freqs[i] - c))]

    def summarize(fm):
        return {"rmsPhase": max(fm["rms"][i] for i in band), "peakPhase": max(fm["peak"][i] for i in band),
                "rmsAmp": max(fm["rmsAmp"][i] for i in band), "ilMax": max(fm["ilMax"][i] for i in band),
                "ilMin": min(fm["ilMin"][i] for i in band), "vswrMax": max(fm["vswrMax"][i] for i in band),
                "monotonic": all(fm["mono"][i] for i in band)}

    d_max = d2 = il_max = il_sum = rms_err = 0.0
    cnt = 0
    for fi in band:
        rms_err = max(rms_err, abs(Mm["rms"][fi] - T["rms"][fi]))
        for k in range(M):
            d = wrap180(rel["phM"][(k, fi)] - rel["phT"][(k, fi)])
            d_max = max(d_max, abs(d))
            d2 += d * d
            di = rel["ilM"][(k, fi)] - rel["ilT"][(k, fi)]
            il_max = max(il_max, abs(di))
            il_sum += di
            cnt += 1
    ai = min(range(nf), key=lambda i: (abs(freqs[i] - p["sweep"]["analysisHz"]), i))
    return {
        "sumT": summarize(T), "sumM": summarize(Mm),
        "acc": {"phaseMax": d_max, "phaseRms": math.sqrt(d2 / cnt), "ilMax": il_max,
                "ilMean": il_sum / cnt, "rmsMetric": rms_err},
        "rmsT": T["rms"], "rmsM": Mm["rms"], "ilMeanM": Mm["ilMean"],
        "phM_analysis": [rel["phM"][(k, ai)] for k in range(M)],
        "vswrM_analysis": [rel["vswrM"][(k, ai)] for k in range(M)],
        "timingTotal": res["timing"]["total"],
        "snr0Db": res["rec"].snr0_db,
    }


# ---------- режимы сверки ----------

def deep_merge(dst, patch):
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v
    return dst


def load_cases(path=None):
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def run_cases(spec):
    out = {}
    for case in spec["cases"]:
        p = deep_merge(json.loads(json.dumps(spec["defaults"])), case.get("patch", {}))
        out[case["name"]] = analyze(run_measurement(p), p)
    return out


def run_cases_json(text):
    """Точка входа для запуска в браузере через Pyodide: принимает текст cases.json."""
    return json.dumps({"engine": f"Python {sys.version.split()[0]}, NumPy {np.__version__}",
                       "cases": run_cases(json.loads(text))})


def main():
    spec = load_cases()
    if "--json" in sys.argv:
        text = run_cases_json(json.dumps(spec))
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python_results.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"Результаты сохранены в {path}")
        return
    results = run_cases(spec)
    print(f"{'Режим':<14}{'СКО изм., °':>12}{'СКО ист., °':>12}{'Потери, дБ':>12}{'КСВН':>8}"
          f"{'Погр. фазы, °':>15}{'Погр. потерь, дБ':>18}")
    print("-" * 91)
    for name, r in results.items():
        print(f"{name:<14}{r['sumM']['rmsPhase']:>12.4f}{r['sumT']['rmsPhase']:>12.4f}{r['sumM']['ilMax']:>12.4f}"
              f"{r['sumM']['vswrMax']:>8.4f}{r['acc']['phaseMax']:>15.5f}{r['acc']['ilMax']:>18.5f}")


if __name__ == "__main__":
    main()
