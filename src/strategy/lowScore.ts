// Low Score — a logistic-regression score for "this bar is a sharp swing low", Deep Dip's exits.
//
// Entry (evaluated on bar close, filled at next bar open):
//   score >= `threshold`, where score = b0 + sum(w_k * z_k) and z_k is feature k standardized with
//   the training mean / stdev (clipped to ±6). 30 features known at the bar's close: returns over
//   1/3/6/12/24 bars, fall from the 6/20-bar high, ATR, RSI 7/14, distance to EMA 9/21/50/200,
//   wicks, body, close position, volume vs the 20-bar average / max, red-bar run, 20/50-bar low,
//   bars since the last 20-bar low, and the last completed hour's EMA 21 distance, RSI and returns.
// Trained on 42 pairs' 15m bars before 2026-08-15 (validated to 09-01); meant for 15m.
// Exits: whatever the `exits` Deep Dip strategy does (its entry is ignored).

import { atr, ema, rsi, type Candle } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

const MU = [0.000118968, 0.000442242, 0.0007863, 0.0013279, 0.00240268, 0.0316996, 0.0597502, 2.00164, 0.0145286, 0.841688, 49.402, 49.5274, -0.0000132864, -0.00000474421, -0.0000477167, -0.000922396, -8.58499, -6.71371, -2.33536, -1.60332, -0.384243, -1.84129, 0.987094, 0.124621, 0.0731191, 2.56243, 0.000382344, 49.4701, 0.00986745, 0.00268161];
const SD = [0.0236435, 0.0395967, 0.0549284, 0.0753606, 0.102908, 0.246744, 0.410633, 1.79125, 0.0358978, 0.794344, 17.7991, 12.867, 0.0280904, 0.0432417, 0.0647509, 0.12505, 1552, 1170.44, 1603.64, 1280.06, 1.34621, 1.46168, 1.38648, 0.330288, 0.260332, 1.10102, 0.0768636, 12.2969, 0.204274, 0.101536];
const W = [0.025015, -0.159251, -0.315455, 0.0285312, 0.0612484, -0.356353, -0.183347, 0.0339631, 0.257859, 0.0060876, -0.79774, -0.0454896, -0.322085, -0.120004, 0.0145242, 0.0182039, 0.0111849, 0.0242227, 0.0119816, 0.00210459, -0.285733, 0.35007, -0.0140962, 0.0453925, -0.0263258, 0.0788672, -0.0143603, 0.127409, -0.0959584, 0.00652684];
const B0 = -5.12204;

export interface LowScoreParams {
  /** Score needed to buy. -1.52 gave ~1.3 trades a pair a month on 15m out of sample. */
  threshold: number;
}

/** Score of every bar (-Infinity where a feature is missing). */
export function lowScores(c: Candle[]): number[] {
  const L = Math.log;
  const cl = c.map((x) => x.close);
  const e9 = ema(cl, 9), e21 = ema(cl, 21), e50 = ema(cl, 50), e200 = ema(cl, 200), r7 = rsi(cl, 7), r14 = rsi(cl, 14), a14 = atr(c, 14);
  // Completed hours only: the hour's last bar is the one before the next hour starts.
  const hc: number[] = [], hEnd: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const h = Math.floor(c[i]!.time / 3600e3);
    if (i + 1 >= c.length || Math.floor(c[i + 1]!.time / 3600e3) !== h) { hc.push(c[i]!.close); hEnd.push(i); }
  }
  const he21 = ema(hc, 21), hr = rsi(hc, 14);
  const out: number[] = [];
  let hp = -1, lastLow = -1;
  for (let i = 0; i < c.length; i++) {
    while (hp + 1 < hEnd.length && hEnd[hp + 1]! <= i) hp++;
    const b = c[i]!;
    let lo20 = true;
    for (let k = Math.max(0, i - 20); k < i; k++) if (c[k]!.low <= b.low) lo20 = false;
    if (i < 60 || hp < 30 || !(a14[i]! > 0) || !(b.high > b.low)) { if (lo20) lastLow = i; out.push(-Infinity); continue; }
    const range = b.high - b.low;
    let hi6 = 0, hi20 = 0, v20 = 0, vmax = 0;
    for (let k = i - 6; k < i; k++) hi6 = Math.max(hi6, c[k]!.high);
    for (let k = i - 20; k < i; k++) { hi20 = Math.max(hi20, c[k]!.high); v20 += c[k]!.volumeUsd; vmax = Math.max(vmax, c[k]!.volumeUsd); }
    v20 /= 20;
    let lo50 = true;
    for (let k = i - 50; k < i; k++) if (c[k]!.low <= b.low) lo50 = false;
    let reds = 0;
    for (let k = i; k >= i - 8 && c[k]!.close < c[k]!.open; k--) reds++;
    const since = lastLow < 0 ? 100 : Math.min(100, i - lastLow);
    if (lo20) lastLow = i;
    const fall6 = hi6 / b.low - 1;
    const x = [
      L(b.close / c[i - 1]!.close), L(b.close / c[i - 3]!.close), L(b.close / c[i - 6]!.close), L(b.close / c[i - 12]!.close), L(b.close / c[i - 24]!.close),
      fall6, hi20 / b.low - 1, fall6 / (a14[i]! / b.close), a14[i]! / b.close, range / a14[i]!, r7[i]!, r14[i]!,
      L(b.close / e9[i]!), L(b.close / e21[i]!), L(b.close / e50[i]!), L(b.close / e200[i]!),
      (Math.min(b.open, b.close) - b.low) / range, (b.high - Math.max(b.open, b.close)) / range, (b.close - b.open) / range, (b.close - b.low) / range,
      L((b.volumeUsd + 1) / (v20 + 1)), L((b.volumeUsd + 1) / (vmax + 1)), reds, lo20 ? 1 : 0, lo50 ? 1 : 0, L(1 + since),
      L(hc[hp]! / he21[hp]!), hr[hp]!, L(hc[hp]! / hc[hp - 24]!), L(hc[hp]! / hc[hp - 6]!),
    ];
    let s = B0;
    for (let k = 0; k < x.length; k++) s += W[k]! * Math.max(-6, Math.min(6, (x[k]! - MU[k]!) / SD[k]!));
    out.push(Number.isFinite(s) ? s : -Infinity);
  }
  return out;
}

export function lowScore(params: LowScoreParams, exits: Strategy): Strategy {
  return {
    name: "Low Score",
    prepare(c) {
      const base = exits.prepare(c);
      const s = lowScores(c);
      const conditions = (i: number) => [
        { label: `Swing-low score ≥ ${params.threshold}`, ok: s[i]! >= params.threshold, detail: Number.isFinite(s[i]!) ? s[i]!.toFixed(2) : "–" },
      ];
      return { ...base, shouldEnter: (i) => s[i]! >= params.threshold, conditions };
    },
  };
}
