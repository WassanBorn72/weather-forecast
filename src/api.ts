import { MODELS } from './providers/models';
import type { Evaluation, Location, Variable, WeatherResponse } from './domain/types';
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export function locationQuery(location: Location): URLSearchParams {
  return location.id.startsWith('point_') ? new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude) }) : new URLSearchParams({ location: location.id });
}
export async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(25000) });
  let payload: Record<string, unknown>;
  try { payload = await response.json(); } catch { throw new Error('APIが応答していません。バックエンドの起動・接続先を確認してください。'); }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'データを取得できませんでした');
  return payload as T;
}
export async function getWeather(location: Location, mode: 'live' | 'demo', signal: AbortSignal): Promise<WeatherResponse> {
  if (mode === 'demo') { const { demoWeather } = await import('./domain/demo'); return demoWeather(location); }
  return jsonRequest(`/api/weather?${locationQuery(location)}`, { signal });
}
export async function getEvaluation(location: Location, mode: 'live' | 'demo', variable: Variable, days: number, lead: number, method: string, season: string, signal: AbortSignal): Promise<Evaluation> {
  if (mode === 'demo') {
    const [{ demoSamples }, { evaluate }] = await Promise.all([import('./domain/demo'), import('./domain/backtest')]);
    const now = new Date().toISOString();
    return evaluate(demoSamples(location, now), MODELS.map(m => m.id), variable, now, days, lead, 'demo', season === '' ? null : Number(season));
  }
  const params = locationQuery(location); params.set('variable', variable); params.set('days', String(days)); params.set('lead', String(lead)); params.set('method', method); if (season !== '') params.set('season', season);
  return jsonRequest(`/api/evaluation?${params}`, { signal });
}
