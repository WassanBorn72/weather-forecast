import { emptyValues, VARIABLES, type Observation } from '../domain/types';
import { utc } from '../domain/time';
import { validValue } from '../providers/openmeteo';
// CSV is deliberately a small fixed schema: quoted columns are not accepted and never silently split.
export function parseObservationCsv(csv: string, locationId: string, source: string, importedAt: string): Observation[] {
  if (!source.trim() || source.length > 200) throw new Error('実測の出典（機関・観測所・URLなど）を指定してください');
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2 || lines.length > 1001) throw new Error('CSVは1〜1000行のデータが必要です');
  const header = lines[0].split(',').map(v => v.trim());
  if (header[0] !== 'observed_at' || new Set(header).size !== header.length || header.slice(1).some(v => !VARIABLES.includes(v as typeof VARIABLES[number]) || v === 'probability')) throw new Error('列はobserved_atと気象変数です。確率は実測値ではありません');
  const seen = new Set<string>();
  return lines.slice(1).map((line, i) => {
    if (line.includes('"')) throw new Error(`行${i + 2}: 引用符は使用できません`);
    const cells = line.split(',').map(v => v.trim());
    if (cells.length !== header.length) throw new Error(`行${i + 2}: 列数が一致しません`);
    const observedAt = utc(cells[0]);
    if (observedAt > importedAt || !observedAt.endsWith(':00:00.000Z')) throw new Error(`行${i + 2}: 過去の毎正時の観測が必要です（オフセット指定可）`);
    if (seen.has(observedAt)) throw new Error(`行${i + 2}: 時刻が重複しています`); seen.add(observedAt);
    const values = emptyValues();
    for (let j = 1; j < header.length; j++) {
      const variable = header[j] as typeof VARIABLES[number];
      if (!cells[j]) continue;
      const parsed = validValue(variable, Number(cells[j]));
      if (parsed === null) throw new Error(`行${i + 2}: ${variable}が不正です`);
      values[variable] = parsed;
    }
    if (!Object.values(values).some(v => v !== null)) throw new Error(`行${i + 2}: 実測値がありません`);
    return { id: crypto.randomUUID(), locationId, observedAt, availableAt: importedAt, importedAt, source: source.trim(), kind: 'station', values };
  });
}
