import { type ModelForecast, type ModelId, type Observation, type Sample, type Score, type Variable, type WeightInfo } from './types';
import { continuous, rainMetrics, RAIN_THRESHOLD } from './metrics';
import { DAY, leadBucket, season } from './time';
import { FIELDS } from '../providers/models';
export function samplesFrom(models: ModelForecast[], observations: Observation[]): Sample[] {
  const byTime = new Map<string, Observation>();
  for (const observation of [...observations].sort((a, b) => a.importedAt.localeCompare(b.importedAt))) byTime.set(observation.observedAt, observation);
  return models.flatMap(model => model.hours.flatMap(hour => {
    const observation = byTime.get(hour.validTime);
    if (!observation || model.run.locationId !== observation.locationId || (model.run.method === 'demo') !== (observation.kind === 'demo') || hour.leadHours <= 0) return [];
    return [{ model: model.run.model, validTime: hour.validTime, decisionTime: model.run.availableAt, forecastAvailableAt: model.run.availableAt, observationAvailableAt: observation.availableAt, leadHours: hour.leadHours, method: model.run.method, predicted: hour.values, observed: observation.values }];
  }));
}
export function observedValue(sample: Sample, variable: Variable): number | null {
  if (variable === 'probability') return sample.observed.precipitation === null ? null : sample.observed.precipitation >= RAIN_THRESHOLD ? 1 : 0;
  return sample.observed[variable];
}
export function filterSamples(samples: Sample[], cutoff: string, days: number, lead: number, targetSeason: number | null = null, training = false): Sample[] {
  const end = Date.parse(cutoff), start = end - days * DAY;
  return samples.filter(s => Date.parse(s.validTime) >= start && Date.parse(s.validTime) < end && s.observationAvailableAt <= cutoff && s.forecastAvailableAt <= cutoff && leadBucket(s.leadHours) === lead && (targetSeason === null || season(s.validTime) === targetSeason) && (!training || s.decisionTime < cutoff));
}
export function deduplicate(samples: Sample[]): Sample[] {
  const byKey = new Map<string, Sample>();
  for (const s of [...samples].sort((a, b) => a.decisionTime.localeCompare(b.decisionTime))) byKey.set(`${s.model}:${s.validTime}`, s);
  return [...byKey.values()];
}
export function calculateScore(samples: Sample[], model: ModelId, variable: Variable, cutoff: string, days: number, lead: number, targetSeason: number | null = null): Score {
  const selected = deduplicate(filterSamples(samples, cutoff, days, lead, targetSeason)).filter(s => s.model === model && s.predicted[variable] !== null && observedValue(s, variable) !== null);
  const pairs: [number, number][] = selected.map(s => [s.predicted[variable]!, observedValue(s, variable)!]);
  const metrics = continuous(pairs, variable);
  let numerator = 0, denominator = 0;
  for (const s of selected) {
    const error = continuous([[s.predicted[variable]!, observedValue(s, variable)!]], variable).mae!;
    const weight = 2 ** (-(Date.parse(cutoff) - Date.parse(s.validTime)) / DAY / 14);
    numerator += weight * (variable === 'probability' ? error ** 2 : error); denominator += weight;
  }
  const rain = variable === 'probability' || variable === 'precipitation' ? rainMetrics(selected.filter(s => s.observed.precipitation !== null).map(s => [variable === 'probability' ? s.predicted.probability! : s.predicted.precipitation! >= RAIN_THRESHOLD ? 1 : 0, s.observed.precipitation!])) : null;
  return { model, variable, lead, days, season: targetSeason, metrics, rain, decayedError: denominator ? numerator / denominator : null, sampleCount: selected.length };
}
export function deriveWeights(scores: Score[], models: ModelId[], variable: Variable): WeightInfo {
  const uniform = Object.fromEntries(models.map(m => [m, 1 / models.length]));
  const relevant = models.map(m => scores.find(s => s.model === m));
  const sampleCount = relevant.length ? Math.min(...relevant.map(s => s?.sampleCount ?? 0)) : 0;
  if (models.length === 1) return { weights: uniform, reason: 'この変数は1モデルのみのため、そのモデルの値を表示しています。', sampleCount, historicalRmse: sampleCount >= 20 ? relevant[0]?.metrics.rmse ?? null : null, weighted: false };
  if (!models.length || sampleCount < 20 || relevant.some(s => s?.decayedError == null)) return { weights: uniform, reason: '比較可能な実測標本が20件未満のため均等重みです。', sampleCount, historicalRmse: null, weighted: false };
  const quality = relevant.map(s => 1 / (0.1 + s!.decayedError! / FIELDS[variable].scale));
  const total = quality.reduce((a, b) => a + b, 0);
  const weights = Object.fromEntries(models.map((m, i) => [m, 0.5 / models.length + 0.5 * quality[i] / total]));
  const best = scores.filter(s => models.includes(s.model)).sort((a, b) => a.decayedError! - b.decayedError!)[0];
  return { weights, reason: `直近30日・半減期14日の誤差が小さい${best.model.toUpperCase()}を重視。50%を均等重みに縮約しています。`, sampleCount, historicalRmse: Math.sqrt(relevant.reduce((sum, s, i) => sum + weights[models[i]] * (s!.metrics.rmse! ** 2), 0)), weighted: true };
}
export function weightsAt(samples: Sample[], models: ModelId[], variable: Variable, cutoff: string, lead: number, validTime: string): WeightInfo {
  const eligible = deduplicate(filterSamples(samples, cutoff, 30, lead, null, true)).filter(s => s.predicted[variable] !== null && observedValue(s, variable) !== null);
  const common = (list: Sample[]) => {
    const times = new Map<string, Set<string>>();
    for (const s of list) { if (!models.includes(s.model)) continue; const set = times.get(s.validTime) ?? new Set<string>(); set.add(s.model); times.set(s.validTime, set); }
    return list.filter(s => times.get(s.validTime)?.size === models.length && models.includes(s.model));
  };
  const targetSeason = season(validTime);
  const seasonal = common(eligible.filter(s => season(s.validTime) === targetSeason));
  const useSeason = new Set(seasonal.map(s => s.validTime)).size >= 20;
  const selected = useSeason ? seasonal : common(eligible);
  const scores = models.map(m => calculateScore(selected, m, variable, cutoff, 30, lead, useSeason ? targetSeason : null));
  const result = deriveWeights(scores, models, variable);
  if (result.weighted) result.reason += useSeason ? ' 同じ季節の標本を使用。' : ' 季節別標本不足のため季節を横断。';
  return result;
}
