import { LEADS } from './types';
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export function utc(input: string | number): string {
  if (typeof input === 'string' && !/(Z|[+-]\d\d:\d\d)$/.test(input)) throw new Error('時刻にはZまたはUTCオフセットが必要です');
  if (typeof input === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(input);
    if (!parts || Number(parts[2]) < 1 || Number(parts[2]) > 12 || Number(parts[3]) < 1 || Number(parts[3]) > new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate() || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6] ?? 0) > 59) throw new Error('不正な時刻です');
  }
  const date = new Date(typeof input === 'number' ? input * 1000 : input);
  if (!Number.isFinite(date.getTime())) throw new Error('不正な時刻です');
  return date.toISOString();
}
export const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / HOUR;
export function leadBucket(hours: number): number | null {
  if (hours <= 0) return null;
  const best = [...LEADS].sort((a, b) => Math.abs(a - hours) - Math.abs(b - hours))[0];
  return Math.abs(best - hours) <= 1 ? best : null;
}
export function season(time: string): number { return Math.floor((new Date(time).getUTCMonth() + 1) % 12 / 3); }
export const localDate = (time: string, zone = 'Asia/Tokyo') => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
export const formatTime = (time: string, zone = 'Asia/Tokyo') => new Intl.DateTimeFormat('ja-JP', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(time));
export const formatDate = (time: string, zone = 'Asia/Tokyo') => new Intl.DateTimeFormat('ja-JP', { timeZone: zone, month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(time));
