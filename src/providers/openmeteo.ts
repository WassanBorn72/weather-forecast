import { emptyValues, type ForecastRun, type Location, type ModelForecast, type RunMethod, type Variable } from '../domain/types';
import { hoursBetween, utc } from '../domain/time';
import { FIELDS, type ModelDefinition } from './models';
export interface ProviderOptions { method?: 'snapshot' | 'single-run' | 'previous-runs'; run?: string; start?: string; end?: string; daysAgo?: number; apiKey?: string; commercial?: boolean }
export interface WeatherProvider { fetch(location: Location, model: ModelDefinition, options?: ProviderOptions): Promise<ModelForecast> }
export function buildUrl(location: Location, model: ModelDefinition, options: ProviderOptions = {}): URL {
  const method = options.method ?? 'snapshot';
  const subdomain = method === 'single-run' ? 'single-runs-api' : method === 'previous-runs' ? 'previous-runs-api' : 'api';
  const url = new URL(`https://${options.commercial ? 'customer-' : ''}${subdomain}.open-meteo.com/v1/forecast`);
  url.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), models: model.apiModel, timezone: 'UTC', timeformat: 'unixtime', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' }).toString();
  const suffix = method === 'previous-runs' ? `_previous_day${options.daysAgo}` : '';
  url.searchParams.set('hourly', (method === 'single-run' ? model.singleRunVariables ?? model.variables : model.variables).map(v => FIELDS[v].api + suffix).join(','));
  if (method === 'single-run') {
    if (!options.run) throw new Error('初期化時刻が必要です');
    const run = utc(options.run);
    if (Date.parse(run) < Date.parse('2026-04-02T00:00:00Z')) throw new Error('このMVPのSingle Runs取得は2026-04-02以降です');
    url.searchParams.set('run', run.slice(0, 16));
    url.searchParams.set('forecast_hours', '169');
  } else if (method === 'previous-runs') {
    if (!Number.isInteger(options.daysAgo) || options.daysAgo! < 1 || options.daysAgo! > 7) throw new Error('Previous Runsは1〜7日前です');
    if (!options.start || !options.end) throw new Error('対象期間が必要です');
    url.searchParams.set('start_date', options.start); url.searchParams.set('end_date', options.end);
  } else url.searchParams.set('forecast_hours', '169');
  if (options.apiKey) url.searchParams.set('apikey', options.apiKey);
  return url;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('APIレスポンスの形式が不正です'); return value as Record<string, unknown>; }
export function validValue(variable: Variable, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if ((variable === 'probability' || variable === 'humidity' || variable === 'cloud') && (value < 0 || value > 100)) return null;
  if (['precipitation', 'windSpeed', 'radiation', 'cape'].includes(variable) && value < 0) return null;
  if (variable === 'windDirection' && (value < 0 || value > 360)) return null;
  if (variable === 'temperature' && (value < -100 || value > 70)) return null;
  if (variable === 'pressure' && (value < 500 || value > 1200)) return null;
  if (variable === 'weatherCode' && ![0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(value)) return null;
  return variable === 'probability' ? value / 100 : value;
}
export function parseOpenMeteo(payload: unknown, location: Location, model: ModelDefinition, options: ProviderOptions, retrievedAt: string, id: string): ModelForecast {
  const root = object(payload);
  if (root.error) throw new Error('提供元APIがエラーを返しました');
  const hourly = object(root.hourly); const units = object(root.hourly_units);
  if (!Array.isArray(hourly.time) || !hourly.time.every(t => typeof t === 'number')) throw new Error('UTC Unix時刻の配列が必要です');
  if (root.utc_offset_seconds !== 0) throw new Error('UTC以外のレスポンスは受け付けません');
  const method: RunMethod = options.method ?? 'snapshot';
  const initializationTime = options.run ? utc(options.run) : null;
  const run: ForecastRun = { id, locationId: location.id, model: model.id, initializationTime, issueTime: null, availableAt: retrievedAt, retrievedAt, source: 'Open-Meteo', method };
  const suffix = method === 'previous-runs' ? `_previous_day${options.daysAgo}` : '';
  const times = hourly.time.map(t => utc(t as number));
  if (new Set(times).size !== times.length || times.some((t, i) => i > 0 && t <= times[i - 1])) throw new Error('対象時刻が重複または逆順です');
  for (const variable of model.variables) {
    const key = FIELDS[variable].api + suffix, arr = hourly[key];
    if (arr !== undefined && (!Array.isArray(arr) || arr.length !== times.length)) throw new Error(`${FIELDS[variable].label}の配列長が一致しません`);
    const expected: Partial<Record<Variable, string>> = { temperature: '°C', windSpeed: 'm/s', precipitation: 'mm', probability: '%', humidity: '%', windDirection: '°', pressure: 'hPa', cloud: '%', radiation: 'W/m²', cape: 'J/kg', weatherCode: 'wmo code' };
    if (Array.isArray(arr) && units[key] !== expected[variable]) throw new Error(`${FIELDS[variable].label}の単位が一致しません`);
  }
  const hours = times.map((validTime, i) => {
    const values = emptyValues();
    for (const variable of model.variables) { const arr = hourly[FIELDS[variable].api + suffix]; values[variable] = Array.isArray(arr) ? validValue(variable, arr[i]) : null; }
    return { runId: id, validTime, leadHours: method === 'previous-runs' ? options.daysAgo! * 24 : hoursBetween(initializationTime ?? retrievedAt, validTime), leadBasis: method === 'previous-runs' ? 'fixed-offset' as const : initializationTime ? 'initialization' as const : 'availability' as const, values };
  });
  if (!hours.some(h => h.values.temperature !== null)) throw new Error('気温の有効データがありません');
  return { run, hours, missing: (Object.keys(FIELDS) as Variable[]).filter(v => !hours.some(h => h.values[v] !== null)) };
}
export class OpenMeteoProvider implements WeatherProvider {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly clock = () => new Date().toISOString()) {}
  async fetch(location: Location, model: ModelDefinition, options: ProviderOptions = {}): Promise<ModelForecast> {
    const response = await this.fetcher(buildUrl(location, model, options), { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const id = options.method === 'single-run' ? `${location.id}:${model.id}:single:${utc(options.run!)}` : options.method === 'previous-runs' ? `${location.id}:${model.id}:previous:${options.start}:${options.end}:${options.daysAgo}` : crypto.randomUUID();
    return parseOpenMeteo(await response.json(), location, model, options, this.clock(), id);
  }
}
