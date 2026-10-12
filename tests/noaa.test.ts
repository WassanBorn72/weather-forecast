import { describe,it,expect } from 'vitest';
import { noaaUrl,parseNoaa,distanceKm } from '../src/providers/noaa';
import { LOCATIONS } from '../src/domain/types';
const imported='2026-10-12T08:00:00.000Z',station='47662099999';
const row={STATION:station,DATE:'2026-10-10T03:00:00',LATITUDE:'35.69',LONGITUDE:'139.75',NAME:'TOKYO, JA',TMP:'+0220,1',DEW:'+0170,1',SLP:'10132,1',WND:'350,1,N,0030,1',AA1:'01,0002,0,1'};
describe('NOAA Global Hourlyの厳密な観測正規化（実応答検証は別途）',()=>{
 it('気温・露点・風・1h降水の倍率を解釈',()=>{const o=parseNoaa([row],station,LOCATIONS[0],imported)[0];expect(o.values.temperature).toBe(22);expect(o.values.precipitation).toBe(.2);expect(o.values.windSpeed).toBe(3);expect(o.values.pressure).toBe(1013.2);expect(o.values.humidity).toBeGreaterThan(70);expect(o.values.humidity).toBeLessThan(80);expect(o.observedAt).toBe('2026-10-10T03:00:00.000Z');expect(o.availableAt).toBe(imported);expect(o.source).toContain('NOAA');});
 it('6時間積算降水を1時間に割り算しない',()=>expect(parseNoaa([{...row,AA1:'06,0100,0,1'}],station,LOCATIONS[0],imported)[0].values.precipitation).toBeNull());
 it('品質不良の値・欠測符号を除外',()=>{const o=parseNoaa([{...row,TMP:'+9999,9',DEW:'+9999,9',SLP:'10132,2',WND:'999,9,N,9999,9',AA1:'01,9999,9,9'}],station,LOCATIONS[0],imported);expect(o).toEqual([]);});
 it('観測時刻を丸めない',()=>expect(parseNoaa([{...row,DATE:'2026-10-10T03:55:00'}],station,LOCATIONS[0],imported)).toEqual([]));
 it('他の観測所・座標不明は使わない',()=>{expect(parseNoaa([{...row,STATION:'00000000000'}],station,LOCATIONS[0],imported)).toEqual([]);expect(parseNoaa([{...row,LATITUDE:null}],station,LOCATIONS[0],imported)).toEqual([]);});
 it('25km超は拒否',()=>expect(()=>parseNoaa([row],station,LOCATIONS[1],imported)).toThrow('25km'));
 it('重複時刻は品質検査済み変数が多いレコード',()=>expect(parseNoaa([{...row,AA1:'01,9999,9,9'},row],station,LOCATIONS[0],imported)).toHaveLength(1));
 it('公式APIのみ・対象期間を制限',()=>{expect(noaaUrl(station,'2026-10-01','2026-10-10').hostname).toBe('www.ncei.noaa.gov');expect(()=>noaaUrl('bad','2026-10-01','2026-10-10')).toThrow();expect(()=>noaaUrl(station,'2026-01-01','2026-10-10')).toThrow();});
 it('Haversine距離',()=>{expect(distanceKm(LOCATIONS[0],LOCATIONS[0])).toBe(0);expect(distanceKm(LOCATIONS[0],LOCATIONS[1])).toBeGreaterThan(350);});
});
