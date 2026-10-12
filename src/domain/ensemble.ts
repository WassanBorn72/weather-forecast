import { emptyValues, VARIABLES, LEADS, type EnsemblePoint, type ModelForecast, type ModelId, type Sample, type Variable } from './types';
import { FIELDS } from '../providers/models';
import { angleDifference } from './metrics';
import { weightsAt } from './scoring';
import { hoursBetween, season } from './time';
export function combine(entries: { model: ModelId; value: number }[], weights: Partial<Record<ModelId, number>>, variable: Variable): number | null {
  const valid = entries.filter(e => Number.isFinite(e.value) && (weights[e.model] ?? 0) > 0);
  const total = valid.reduce((sum, e) => sum + weights[e.model]!, 0);
  if (!total) return null;
  if (variable === 'weatherCode') {
    const counts = new Map<number, number>(); for (const e of valid) counts.set(e.value, (counts.get(e.value) ?? 0) + weights[e.model]! / total);
    return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }
  if (variable === 'windDirection') {
    const x = valid.reduce((s, e) => s + Math.cos(e.value * Math.PI / 180) * weights[e.model]! / total, 0);
    const y = valid.reduce((s, e) => s + Math.sin(e.value * Math.PI / 180) * weights[e.model]! / total, 0);
    if (Math.hypot(x, y) < 1e-8) return null;
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  return valid.reduce((sum, e) => sum + e.value * weights[e.model]! / total, 0);
}
export function buildEnsemble(models: ModelForecast[], samples: Sample[], cutoff: string): EnsemblePoint[] {
  const times = [...new Set(models.flatMap(m => m.hours.map(h => h.validTime)))].filter(t => t >= cutoff.slice(0, 13) + ':00:00.000Z').sort();
  const indexed = new Map(models.map(m => [m.run.model, new Map(m.hours.map(h => [h.validTime, h.values]))]));
  const weightCache = new Map<string, EnsemblePoint['weights'][Variable]>();
  return times.map(validTime => {
    const values = emptyValues(), simple = emptyValues(), weights = {} as EnsemblePoint['weights'], uncertainty = {} as EnsemblePoint['uncertainty'];
    const horizonHours = Math.max(1, hoursBetween(cutoff, validTime));
    const lead = [...LEADS].sort((a, b) => Math.abs(a - horizonHours) - Math.abs(b - horizonHours))[0];
    for (const variable of VARIABLES) {
      const entries = models.flatMap(m => { const value = indexed.get(m.run.model)?.get(validTime)?.[variable]; return value == null ? [] : [{ model: m.run.model, value }]; });
      // Category weighting uses uniform voting: code distances do not define a meaningful error.
      const key = `${variable}:${lead}:${season(validTime)}:${entries.map(e => e.model).join(',')}`;
      if (!weightCache.has(key)) {
        const info = weightsAt(variable === 'weatherCode' ? [] : samples, entries.map(e => e.model), variable, cutoff, lead, validTime);
        info.reason = `重みの参照リード: +${lead}時間。${info.reason}`;
        weightCache.set(key, info);
      }
      weights[variable] = weightCache.get(key)!;
      values[variable] = combine(entries, weights[variable].weights, variable);
      simple[variable] = combine(entries, Object.fromEntries(entries.map(e => [e.model, 1])), variable);
      const mean = simple[variable], historical = weights[variable].historicalRmse;
      const spread = entries.length && mean !== null && variable !== 'weatherCode' ? Math.sqrt(entries.reduce((sum, e) => sum + (variable === 'windDirection' ? angleDifference(e.value, mean) : e.value - mean) ** 2, 0) / entries.length) : null;
      const scale = variable === 'probability' ? 0.2 : FIELDS[variable].scale;
      const disagreement = entries.length > 1 && (variable === 'windDirection' ? (spread ?? 0) >= scale : Math.max(...entries.map(e => e.value)) - Math.min(...entries.map(e => e.value)) >= 1.5 * scale);
      const horizon = Math.max(0, hoursBetween(cutoff, validTime)), count = weights[variable].sampleCount;
      const confidence = count < 20 || historical === null || entries.length < 2 || disagreement || horizon > 72 ? '低' : historical <= .75 * scale && (spread ?? Infinity) <= .5 * scale && horizon <= 24 && count >= 100 ? '高' : '中';
      uncertainty[variable] = { spread, error: historical !== null && spread !== null ? Math.sqrt(historical ** 2 + spread ** 2) : null, confidence, modelCount: entries.length, disagreement };
    }
    const temperature = uncertainty.temperature;
    return { validTime, values, simple, weights, uncertainty, confidence: temperature.confidence, temperatureSpread: temperature.spread, temperatureError: temperature.error, disagreement: temperature.disagreement, modelCount: temperature.modelCount };
  });
}
