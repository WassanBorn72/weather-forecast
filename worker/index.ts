import { LOCATIONS, LEADS, WINDOWS, type Location, type ModelForecast, type RunMethod, type Sample, type Variable, type WeatherResponse } from '../src/domain/types';
import { HOUR, DAY, utc } from '../src/domain/time';
import { buildEnsemble } from '../src/domain/ensemble';
import { samplesFrom } from '../src/domain/scoring';
import { evaluate } from '../src/domain/backtest';
import { demoSamples, demoWeather } from '../src/domain/demo';
import { MODELS, FIELDS } from '../src/providers/models';
import { OpenMeteoProvider, type ProviderOptions } from '../src/providers/openmeteo';
import { fetchNoaa } from '../src/providers/noaa';
import { Repository } from '../src/server/repository';
import { parseObservationCsv } from '../src/server/observations';
export interface Env { DB: D1Database; ADMIN_TOKEN?: string; OPEN_METEO_API_KEY?: string; OPEN_METEO_MODE?: string; ALLOWED_ORIGIN?: string; COLLECT_LOCATION_IDS?: string }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function numeric(query: URLSearchParams, key: string, fallback: number) { const raw = query.get(key); if (raw === null) return fallback; const n = Number(raw); if (!Number.isFinite(n) || !raw.trim()) throw new HttpError(400, `${key}が不正です`); return n; }
export function resolveLocation(query: URLSearchParams): Location {
  if (query.has('latitude') || query.has('longitude')) {
    if (!query.has('latitude') || !query.has('longitude')) throw new HttpError(400, '緯度・経度の両方が必要です');
    const latitude = numeric(query, 'latitude', 0), longitude = numeric(query, 'longitude', 0);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new HttpError(400, '緯度・経度の範囲が不正です');
    // Coarse location cache avoids persisting device precision. Same coordinates imply the same identity.
    const lat = Number(latitude.toFixed(2)), lon = Number(longitude.toFixed(2));
    return { id: `point_${lat}_${lon}`, name: `指定地点 ${lat.toFixed(2)}, ${lon.toFixed(2)}`, latitude: lat, longitude: lon, timezone: 'Asia/Tokyo' };
  }
  const id = query.get('location') ?? 'tokyo', known = LOCATIONS.find(l => l.id === id);
  if (!known) throw new HttpError(400, '地点が見つかりません');
  return known;
}
function providerOptions(env: Env): ProviderOptions {
  const commercial = env.OPEN_METEO_MODE === 'commercial';
  if (commercial && !env.OPEN_METEO_API_KEY) throw new HttpError(503, '商用APIキーが未設定です');
  return { commercial, apiKey: env.OPEN_METEO_API_KEY };
}
async function collect(location: Location, env: Env, extra: ProviderOptions = {}) {
  const options = { ...providerOptions(env), ...extra };
  const provider = new OpenMeteoProvider();
  const results = await Promise.allSettled(MODELS.map(m => provider.fetch(location, m, options)));
  const models: ModelForecast[] = [], warnings: string[] = [];
  results.forEach((result, i) => { if (result.status === 'fulfilled') models.push(result.value); else warnings.push(`${MODELS[i].label}: 取得できませんでした（${result.reason instanceof Error ? result.reason.message : '通信エラー'}）`); });
  return { models, warnings };
}
async function liveSamples(repository: Repository, locationId: string, cutoff: string): Promise<Sample[]> {
  const observations = await repository.observations(locationId, cutoff, 30);
  if (!observations.length) return [];
  const histories = await Promise.all(LEADS.map(lead => repository.history(locationId, cutoff, 30, lead, 'snapshot')));
  return samplesFrom(histories.flat(), observations);
}
export async function liveWeather(location: Location, env: Env, force = false): Promise<WeatherResponse> {
  const repository = new Repository(env.DB); let now = new Date().toISOString();
  await repository.ensureLocation(location);
  const existing = await repository.latestModels(location.id);
  const fresh = existing.length && existing.every(m => Date.parse(now) - Date.parse(m.run.retrievedAt) < HOUR);
  let models = existing, warnings: string[] = [], stale = false;
  if (!fresh || force) {
    const result = await collect(location, env);
    warnings = result.warnings;
    if (result.models.length) { models = result.models; await repository.saveModels(models); }
    else if (existing.length) { stale = true; warnings.push('APIに接続できないため保存済みの予報を表示しています。'); }
    else throw new HttpError(502, '予報APIからデータを取得できませんでした。接続設定を確認するか、デモを選択してください。');
  }
  // A decision cutoff must be after all input forecasts have actually arrived.
  now = new Date().toISOString();
  // Forecast horizon may have expired even though snapshots exist.
  models = models.filter(m => m.hours.some(h => h.validTime >= now));
  if (!models.length) throw new HttpError(503, '保存済み予報の対象期間が終了しています。更新が必要です。');
  for (const definition of MODELS) if (!models.some(m => m.run.model === definition.id) && !warnings.some(w => w.startsWith(definition.label))) warnings.push(`${definition.label}: この地点では利用可能な保存予報がありません。`);
  const samples = await liveSamples(repository, location.id, now), ensemble = buildEnsemble(models, samples, now);
  const fetchedAt = models.map(m => m.run.retrievedAt).sort()[0];
  stale ||= Date.parse(now) - Date.parse(fetchedAt) > 6 * HOUR;
  const observations = await repository.observations(location.id, now, 2);
  const observation = observations.filter(o => o.availableAt <= now).at(-1) ?? null;
  await repository.saveEnsemble(location.id, now, ensemble, models.map(m => m.run.id));
  if (!samples.length) warnings.push('実測との比較がまだないため、均等重みを使用しています。信頼度は未検証です。');
  return { location, mode: 'live', fetchedAt, stale, models, ensemble, warnings, observation };
}
async function authorized(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, '管理機能にはADMIN_TOKENの設定が必要です');
  const candidate = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const hash = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([hash(candidate), hash(env.ADMIN_TOKEN)]);
  const first = new Uint8Array(a), second = new Uint8Array(b);
  let difference = 0; for (let i = 0; i < first.length; i++) difference |= first[i] ^ second[i];
  if (difference) throw new HttpError(401, '管理トークンが一致しません');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('Content-Length'));
  if (length > 250_000) throw new HttpError(413, '取り込みは250KB以下にしてください');
  const text = await request.text(); if (new TextEncoder().encode(text).length > 250_000) throw new HttpError(413, '取り込みは250KB以下にしてください');
  try { const result = JSON.parse(text); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; } catch { throw new HttpError(400, 'JSONの形式が不正です'); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get('Origin'), allowed = env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin === allowed) headers['Access-Control-Allow-Origin'] = allowed;
    if (origin && origin !== allowed && origin !== url.origin) return Response.json({ error: 'このOriginは許可されていません' }, { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
    try {
      let result: unknown;
      if (url.pathname === '/api/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT id FROM locations LIMIT 1').first(); result = { status: 'ok', storage: 'D1', phase: 1 };
      } else if (url.pathname === '/api/weather' && request.method === 'GET') {
        const location = resolveLocation(url.searchParams), mode = url.searchParams.get('mode') ?? 'live';
        if (!['live', 'demo'].includes(mode)) throw new HttpError(400, 'modeが不正です');
        result = mode === 'demo' ? demoWeather(location) : await liveWeather(location, env);
      } else if (url.pathname === '/api/evaluation' && request.method === 'GET') {
        const location = resolveLocation(url.searchParams), now = new Date().toISOString();
        const days = numeric(url.searchParams, 'days', 30), lead = numeric(url.searchParams, 'lead', 24);
        const variable = (url.searchParams.get('variable') ?? 'temperature') as Variable;
        const method = (url.searchParams.get('method') ?? 'snapshot') as 'snapshot' | 'single-run' | 'previous-runs';
        const targetSeason = url.searchParams.has('season') ? numeric(url.searchParams, 'season', 0) : null;
        if (!(WINDOWS as readonly number[]).includes(days) || !(LEADS as readonly number[]).includes(lead) || !Object.hasOwn(FIELDS, variable) || variable === 'weatherCode' || !['snapshot','single-run','previous-runs'].includes(method) || (targetSeason !== null && ![0,1,2,3].includes(targetSeason))) throw new HttpError(400, '評価条件が不正です');
        if (method === 'previous-runs' && lead % 24) throw new HttpError(400, 'Previous Runsは24時間単位のリードのみです');
        const mode = url.searchParams.get('mode') ?? 'live';
        if (!['live','demo'].includes(mode)) throw new HttpError(400, 'modeが不正です');
        const repository = new Repository(env.DB);
        if (mode === 'demo') result = evaluate(demoSamples(location, now), MODELS.map(m => m.id), variable, now, days, lead, 'demo', targetSeason);
        else {
          await repository.ensureLocation(location);
          const history = await repository.history(location.id, now, days + 30, lead, method), observations = await repository.observations(location.id, now, days + 30);
          const samples = samplesFrom(history, observations);
          // Only models actually supplying this variable are comparable. Missing models are still shown in diagnostics.
          const candidates = MODELS.filter(m => m.variables.includes(variable)).map(m => m.id);
          const evaluation = evaluate(samples, candidates, variable, now, days, lead, method, targetSeason);
          await repository.saveEvaluation(location.id, evaluation, history.map(m => m.run.id), observations.map(o => o.id));
          result = evaluation;
        }
      } else if (url.pathname === '/api/admin/noaa' && request.method === 'POST') {
        await authorized(request, env); const input = await body(request), location = resolveLocation(url.searchParams);
        if (typeof input.station !== 'string' || typeof input.start !== 'string' || typeof input.end !== 'string') throw new HttpError(400, '観測所IDと開始・終了日が必要です');
        let observations;
        try { observations = await fetchNoaa(location, input.station, input.start, input.end); }
        catch (e) { throw new HttpError(502, e instanceof Error ? e.message : 'NOAA観測を取得できませんでした'); }
        const repository = new Repository(env.DB); await repository.ensureLocation(location);
        const inserted = await repository.importObservations(observations);
        result = { inserted, ignored: observations.length - inserted, source: observations[0].source, message: 'NOAAの品質検査済み観測を取り込みました。湿度は露点から算出、降水は1時間量のみ。公開時刻は推定せず今回の取得時刻を保存します。' };
      } else if (url.pathname === '/api/admin/observations' && request.method === 'POST') {
        await authorized(request, env); const input = await body(request), location = resolveLocation(url.searchParams);
        if (typeof input.csv !== 'string' || typeof input.source !== 'string') throw new HttpError(400, 'csvとsourceが必要です');
        const observations = parseObservationCsv(input.csv, location.id, input.source, new Date().toISOString());
        const repository = new Repository(env.DB); await repository.ensureLocation(location);
        const inserted = await repository.importObservations(observations);
        result = { inserted, ignored: observations.length - inserted, message: '観測は追記保存。利用可能時刻は今回の取り込み時刻です。既存の観測は上書きしません。' };
      } else if (url.pathname === '/api/admin/history' && request.method === 'POST') {
        await authorized(request, env); const input = await body(request), location = resolveLocation(url.searchParams);
        let options: ProviderOptions;
        if (input.method === 'single-run' && typeof input.run === 'string') {
          const run = utc(input.run);
          if (run >= new Date().toISOString() || !run.endsWith(':00:00.000Z') || new Date(run).getUTCHours() % 6 !== 0) throw new HttpError(400, '過去の00/06/12/18 UTCの初期化時刻を指定してください');
          options = { method: 'single-run', run };
        } else if (input.method === 'previous-runs' && typeof input.start === 'string' && typeof input.end === 'string' && typeof input.daysAgo === 'number') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start) || !/^\d{4}-\d{2}-\d{2}$/.test(input.end)) throw new HttpError(400, '日付はYYYY-MM-DDです');
          const start = Date.parse(input.start), end = Date.parse(input.end);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 30 * DAY || end > Date.now()) throw new HttpError(400, '過去の31日以内の期間を指定してください');
          options = { method: 'previous-runs', start: input.start, end: input.end, daysAgo: input.daysAgo };
        } else throw new HttpError(400, '過去予報の取り込み条件が不正です');
        const resultCollection = await collect(location, env, options);
        if (!resultCollection.models.length) throw new HttpError(502, '過去予報を取得できませんでした。対象runやネットワーク設定を確認してください');
        const repository = new Repository(env.DB); await repository.ensureLocation(location); await repository.saveModels(resultCollection.models);
        result = { importedModels: resultCollection.models.map(m => m.run.model), runIds: resultCollection.models.map(m => m.run.id), warnings: resultCollection.warnings, message: '取得時刻と初期化／固定オフセットを保存しました。過去の公開時刻は推定していません。' };
      } else if (url.pathname === '/api/admin/collect' && request.method === 'POST') {
        await authorized(request, env); result = await liveWeather(resolveLocation(url.searchParams), env, true);
      } else throw new HttpError(404, 'APIが見つかりません');
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof Error && /時刻|CSV|行\d|実測|初期化/.test(error.message) ? 400 : 500;
      return Response.json({ error: status === 500 ? '保存または計算に失敗しました。DBマイグレーションと設定を確認してください。' : (error as Error).message }, { status, headers });
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    // Sequential locations bound API fanout. Live processes are not required for Cron in production.
    for (const id of (env.COLLECT_LOCATION_IDS ?? 'tokyo').split(',').map(v => v.trim()).filter(Boolean).slice(0, 10)) {
      const location = LOCATIONS.find(l => l.id === id);
      if (!location) continue;
      try { await liveWeather(location, env, true); } catch { console.error(`Forecast collection failed for ${id}`); }
    }
  },
};
