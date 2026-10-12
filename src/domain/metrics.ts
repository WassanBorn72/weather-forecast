import { type CalibrationBin, type ContinuousMetrics, type RainMetrics, type Variable } from './types';
export const RAIN_THRESHOLD = 0.1;
export const angleDifference = (a: number, b: number) => ((a - b + 540) % 360) - 180;
export function continuous(pairs: [number, number][], variable?: Variable): ContinuousMetrics {
  const valid = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!valid.length) return { count: 0, mae: null, rmse: null, bias: null };
  const errors = valid.map(([a, b]) => variable === 'windDirection' ? angleDifference(a, b) : a - b);
  return { count: valid.length, mae: errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length, rmse: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length), bias: errors.reduce((s, e) => s + e, 0) / errors.length };
}
export function rainMetrics(pairs: [number, number][]): RainMetrics {
  const valid = pairs.filter(([p, rain]) => Number.isFinite(p) && p >= 0 && p <= 1 && Number.isFinite(rain) && rain >= 0);
  let tp = 0, tn = 0, fp = 0, fn = 0, squared = 0;
  const bins: { p: number[]; y: number[] }[] = Array.from({ length: 10 }, () => ({ p: [], y: [] }));
  for (const [p, rain] of valid) {
    const y = rain >= RAIN_THRESHOLD ? 1 : 0, prediction = p >= 0.5;
    if (prediction && y) tp++; else if (prediction) fp++; else if (y) fn++; else tn++;
    squared += (p - y) ** 2;
    const bin = bins[Math.min(9, Math.floor(p * 10))]; bin.p.push(p); bin.y.push(y);
  }
  const count = valid.length, rainCount = tp + fn;
  const calibration: CalibrationBin[] = bins.map((b, i) => ({ lower: i / 10, upper: (i + 1) / 10, count: b.p.length, predicted: b.p.length ? b.p.reduce((s, p) => s + p, 0) / b.p.length : null, observed: b.y.length ? b.y.reduce((s, y) => s + y, 0) / b.y.length : null }));
  return { count, rainCount, accuracy: count ? (tp + tn) / count : null, precision: tp + fp ? tp / (tp + fp) : null, recall: rainCount ? tp / rainCount : null, f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null, brier: count ? squared / count : null, alwaysDryAccuracy: count ? (count - rainCount) / count : null, climatologyBrier: count ? rainCount / count * (1 - rainCount / count) : null, calibration };
}
