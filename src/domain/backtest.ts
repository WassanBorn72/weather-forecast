import { type Baseline, type Evaluation, type ModelId, type Sample, type Variable } from './types';
import { filterSamples, deduplicate, observedValue, calculateScore, weightsAt } from './scoring';
import { continuous, rainMetrics, RAIN_THRESHOLD } from './metrics';
import { combine } from './ensemble';
export function evaluate(samples: Sample[], models: ModelId[], variable: Variable, cutoff: string, days: number, lead: number, method: Evaluation['method'], targetSeason: number | null): Evaluation {
  const sameMethod = samples.filter(s => s.method === method);
  const selected = deduplicate(filterSamples(sameMethod, cutoff, days, lead, targetSeason)).filter(s => s.predicted[variable] !== null && observedValue(s, variable) !== null);
  const scores = models.map(m => calculateScore(selected, m, variable, cutoff, days, lead, targetSeason));
  const byTime = new Map<string, Sample[]>();
  for (const s of selected) { const group = byTime.get(s.validTime) ?? []; group.push(s); byTime.set(s.validTime, group); }
  const pairs = new Map<string, [number, number][]>([...models.map(m => [m, []] as [string, [number, number][]]), ['単純平均', []], ['精度ベース統合', []]]);
  const rainPairs = new Map<string, [number, number][]>([...pairs.keys()].map(k => [k, []]));
  let excluded = 0, commonCount = 0;
  for (const group of [...byTime.values()].sort((a, b) => a[0].validTime.localeCompare(b[0].validTime))) {
    const common = models.map(m => group.find(s => s.model === m));
    // Archive imports lack historical public availability evidence: no deployable hindsight backtest.
    if (common.some(s => !s) || (method !== 'snapshot' && method !== 'demo')) { excluded++; continue; }
    const rows = common as Sample[], decision = rows.map(s => s.decisionTime).sort().at(-1)!;
    if (decision >= rows[0].validTime) { excluded++; continue; }
    const y = observedValue(rows[0], variable)!;
    const weights = weightsAt(sameMethod, models, variable, decision, lead, rows[0].validTime);
    const entries = rows.map(s => ({ model: s.model, value: s.predicted[variable]! }));
    const mean = combine(entries, Object.fromEntries(models.map(m => [m, 1])), variable);
    const weighted = combine(entries, weights.weights, variable);
    if (mean === null || weighted === null) { excluded++; continue; }
    for (const s of rows) pairs.get(s.model)!.push([s.predicted[variable]!, y]);
    pairs.get('単純平均')!.push([mean, y]); pairs.get('精度ベース統合')!.push([weighted, y]);
    if (variable === 'probability' || variable === 'precipitation') {
      const observedRain = rows[0].observed.precipitation!;
      const probability = (v: number) => variable === 'probability' ? v : v >= RAIN_THRESHOLD ? 1 : 0;
      for (const s of rows) rainPairs.get(s.model)!.push([probability(s.predicted[variable]!), observedRain]);
      rainPairs.get('単純平均')!.push([probability(mean), observedRain]); rainPairs.get('精度ベース統合')!.push([probability(weighted), observedRain]);
    }
    commonCount++;
  }
  const baselines: Baseline[] = [...pairs].map(([name, list]) => ({ name, count: list.length, metrics: continuous(list, variable), rain: variable === 'probability' || variable === 'precipitation' ? rainMetrics(rainPairs.get(name)!) : null }));
  return { variable, lead, days, season: targetSeason, scores, baselines, commonCount, excluded, trainingDays: 30, status: method !== 'snapshot' && method !== 'demo' ? '公開時刻の証跡がない過去runは単独診断のみ。運用統合の比較対象にはしません。' : commonCount < 20 ? '共通の検証標本が20件未満です。精度改善は未検証です。' : '各予報時点までの30日で重みを学習し、その後の実測で比較。改善の有無は下の同一標本の指標を確認してください。', method, cutoff };
}
