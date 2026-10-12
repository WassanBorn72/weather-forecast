import { WeatherIcon, weatherLabel } from './WeatherIcon';
import { MODELS, FIELDS } from '../providers/models';
import { formatTime } from '../domain/time';
import type { WeatherResponse, Variable } from '../domain/types';
export function ForecastChart({ data, variable, start, onSelect }: { data: WeatherResponse; variable: Variable; start: number; onSelect: (i: number) => void }) {
  const points = data.ensemble.slice(start, start + 24), timeIndex = new Map(points.map((p, i) => [p.validTime, i]));
  const lines = data.models.map(m => ({ label: MODELS.find(x => x.id === m.run.model)!.label, color: MODELS.find(x => x.id === m.run.model)!.color, values: points.map(p => m.hours.find(h => h.validTime === p.validTime)?.values[variable] ?? null) }));
  lines.push({ label: '統合予報', color: '#18394a', values: points.map(p => p.values[variable]) });
  if (variable === 'weatherCode') return <div className="table-wrap"><table><caption className="sr-only">時間別の天気状態をモデルで比較</caption><thead><tr><th>時刻（JST）</th>{lines.map(line => <th key={line.label}>{line.label}</th>)}</tr></thead><tbody>{points.map((point, i) => <tr key={point.validTime}><td>{formatTime(point.validTime)}</td>{lines.map(line => <td key={line.label}><WeatherIcon code={line.values[i]} size={20}/>{weatherLabel(line.values[i])}</td>)}</tr>)}</tbody></table></div>;
  const values = lines.flatMap(l => l.values).filter((v): v is number => v !== null);
  if (!points.length || !values.length) return <p className="empty">この変数のデータはありません。</p>;
  const min = variable === 'probability' ? 0 : Math.min(...values) - 1, max = variable === 'probability' ? 1 : Math.max(...values) + 1;
  const x = (i: number) => 48 + i * 650 / Math.max(1, points.length - 1), y = (v: number) => 170 - (v - min) / Math.max(0.01, max - min) * 135;
  const label = (v: number) => variable === 'probability' ? `${Math.round(v * 100)}%` : v.toFixed(1);
  return <div className="chart-wrap"><svg viewBox="0 0 730 215" role="img" aria-label={`${FIELDS[variable].label}のモデル別24時間予報。下の時刻選択で数値を確認できます。`}>
    {[0, 1, 2, 3].map(i => { const v = min + (max - min) * i / 3; return <g key={i}><line x1="48" x2="698" y1={y(v)} y2={y(v)} stroke="#e1e6e7" strokeDasharray="3 5"/><text x="38" y={y(v) + 4} textAnchor="end" className="chart-label">{label(v)}</text></g>; })}
    {lines.map((line, index) => { const segments: string[] = []; let current = ''; line.values.forEach((v, i) => { if (v === null) { if (current) segments.push(current); current = ''; } else current += `${current ? ' L' : 'M'}${x(i)},${y(v)}`; }); if (current) segments.push(current); return <g key={line.label}>{segments.map((d, i) => <path key={i} d={d} fill="none" stroke={line.color} strokeWidth={index === lines.length - 1 ? 3.5 : 1.5} opacity={index === lines.length - 1 ? 1 : .7}/>)}</g>; })}
    {points.filter((_, i) => i % 4 === 0).map(p => <text key={p.validTime} x={x(timeIndex.get(p.validTime)!)} y="198" textAnchor="middle" className="chart-label">{formatTime(p.validTime)}</text>)}
  </svg><div className="chart-legend">{lines.map(l => <span key={l.label}><i style={{ background: l.color }}/>{l.label}</span>)}</div><div className="time-picker" aria-label="詳細を表示する時刻">{points.filter((_, i) => i % 3 === 0).map(p => <button key={p.validTime} onClick={() => onSelect(start + timeIndex.get(p.validTime)!)}>{formatTime(p.validTime)}の詳細</button>)}</div></div>;
}
