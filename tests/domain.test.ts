import { describe, expect, it } from 'vitest';
import { continuous, rainMetrics, angleDifference } from '../src/domain/metrics';
import { deriveWeights, samplesFrom, weightsAt, calculateScore } from '../src/domain/scoring';
import { combine, buildEnsemble } from '../src/domain/ensemble';
import { evaluate } from '../src/domain/backtest';
import { demoSamples, demoWeather } from '../src/domain/demo';
import { utc, hoursBetween, localDate, leadBucket, season, HOUR } from '../src/domain/time';
import { LOCATIONS, emptyValues, type Score, type Sample } from '../src/domain/types';
import { MODELS } from '../src/providers/models';
const cutoff = '2026-10-12T08:00:00.000Z';
const samples = () => demoSamples(LOCATIONS[0], cutoff);
const modelIds = MODELS.map(m => m.id);
describe('時刻とリード', () => {
  it('JSTをUTCへ変換し日付境界を維持', () => { expect(utc('2026-10-11T00:00:00+09:00')).toBe('2026-10-10T15:00:00.000Z'); expect(localDate('2026-10-10T15:00:00Z')).toBe('2026-10-11'); });
  it('offsetなしの曖昧時刻を拒否', () => { expect(() => utc('2026-10-11T12:00:00')).toThrow(); expect(() => utc('badZ')).toThrow(); });
  it('24h先をUTCで計算', () => expect(hoursBetween('2026-10-10T03:00:00Z','2026-10-11T03:00:00Z')).toBe(24));
  it('Unix秒を変換', () => expect(utc(0)).toBe('1970-01-01T00:00:00.000Z'));
  it('leadの許容差と範囲外', () => { expect(leadBucket(23.9)).toBe(24); expect(leadBucket(36)).toBe(null); expect(leadBucket(-1)).toBe(null); });
  it('冬・春・夏・秋', () => expect(['2026-01-01','2026-04-01','2026-07-01','2026-10-01'].map(d => season(`${d}T00:00:00Z`))).toEqual([0,1,2,3]));
});
describe('評価指標', () => {
  it('MAE RMSE Bias', () => { const result = continuous([[2,1],[4,6],[3,3]]); expect(result.mae).toBe(1); expect(result.rmse).toBeCloseTo(Math.sqrt(5/3)); expect(result.bias).toBeCloseTo(-1/3); });
  it('ゼロ標本は0誤差としない', () => expect(continuous([])).toEqual({count:0,mae:null,rmse:null,bias:null}));
  it('非有限値を除く', () => expect(continuous([[NaN,1],[3,4]])).toMatchObject({count:1,mae:1}));
  it('風向は最短角距離', () => { expect(angleDifference(350,10)).toBe(-20); expect(continuous([[350,10]],'windDirection').mae).toBe(20); });
  it('降雨分類・Brier・校正', () => { const m = rainMetrics([[.8,1],[.6,0],[.3,2],[.1,0]]); expect(m.accuracy).toBe(.5); expect(m.precision).toBe(.5); expect(m.recall).toBe(.5); expect(m.f1).toBe(.5); expect(m.brier).toBeCloseTo((.04+.36+.49+.01)/4); expect(m.calibration.reduce((s,b)=>s+b.count,0)).toBe(4); });
  it('常に無降雨は高AccuracyでもRecall0', () => { const m = rainMetrics([...Array.from({length:9},()=>[0,0] as [number,number]),[0,1]]); expect(m.accuracy).toBe(.9); expect(m.alwaysDryAccuracy).toBe(.9); expect(m.recall).toBe(0); expect(m.f1).toBe(0); expect(m.precision).toBe(null); });
  it('確率1と降雨閾値0.1を含む', () => { const m = rainMetrics([[1,.1],[0,0]]); expect(m.brier).toBe(0); expect(m.calibration[9].count).toBe(1); });
});
describe('重みと欠測', () => {
  const scores = () => modelIds.map((model,i)=>calculateScore(samples(),model,'temperature',cutoff,30,24,null));
  it('重みの合計1・正規化・shrinkage制約', () => { const result = deriveWeights(scores(),modelIds,'temperature'); expect(result.weighted).toBe(true); expect(Object.values(result.weights).reduce((s,w)=>s+w!,0)).toBeCloseTo(1); for(const w of Object.values(result.weights)) {expect(w).toBeGreaterThanOrEqual(.125);expect(w).toBeLessThanOrEqual(.625);} });
  it('極端な誤差を入れても一つのモデルに集中しない', () => { const extreme = scores().map((s,i)=>({...s,decayedError:i?1e8:0})); expect(deriveWeights(extreme,modelIds,'temperature').weights.jma).toBeLessThanOrEqual(.625); });
  it('20件未満は均等', () => { const result = deriveWeights(scores().map(s=>({...s,sampleCount:3})),modelIds,'temperature'); expect(result.weighted).toBe(false); expect(result.weights.gfs).toBe(.25); });
  it('欠測モデルを除いて合計1', () => { const result=weightsAt(samples(),['ecmwf','gfs'],'temperature',cutoff,24,'2026-10-13T08:00:00Z');expect(Object.values(result.weights).reduce((s,w)=>s+w!,0)).toBeCloseTo(1);expect(result.weights.jma).toBeUndefined(); });
  it('重み学習は各モデル共通時刻を使う', () => { const sparse = samples().filter(s=>s.model!=='icon' || s.validTime>'2026-10-09'); const result=weightsAt(sparse,modelIds,'temperature',cutoff,24,'2026-10-13T08:00:00Z'); expect(result.weighted).toBe(false); });
  it('降水確率は降水実測の0/1で比較', () => { const score=calculateScore(samples(),'ecmwf','probability',cutoff,30,24); expect(score.rain?.count).toBeGreaterThan(20);expect(score.rain?.brier).not.toBeNull(); });
});
describe('統合', () => {
  it('重み付きと欠測時の再正規化', () => { expect(combine([{model:'jma',value:10},{model:'gfs',value:20}],{jma:.75,gfs:.25},'temperature')).toBe(12.5); expect(combine([{model:'jma',value:10}],{jma:.1,gfs:.9},'temperature')).toBe(10); });
  it('空の予報はnull', () => expect(combine([],{jma:1},'temperature')).toBe(null));
  it('風向350°と10°は北', () => { const v=combine([{model:'jma',value:350},{model:'gfs',value:10}],{jma:.5,gfs:.5},'windDirection'); expect(v!%360).toBeCloseTo(0); });
  it('正反対の風向は未定義', () => expect(combine([{model:'jma',value:0},{model:'gfs',value:180}],{jma:.5,gfs:.5},'windDirection')).toBe(null));
  it('天気コードは数字の平均でなく投票', () => expect(combine([{model:'jma',value:61},{model:'gfs',value:0}],{jma:.7,gfs:.3},'weatherCode')).toBe(61));
  it('全モデルの確率欠測を捏造しない・未検証は低信頼', () => { const data=demoWeather(LOCATIONS[0],cutoff);for(const model of data.models)for(const h of model.hours)h.values.probability=null;const ensemble=buildEnsemble(data.models,[],cutoff);expect(ensemble[0].values.probability).toBe(null);expect(ensemble[0].confidence).toBe('低'); });
});
describe('データリークとベースライン', () => {
  it('未来の観測・未到着の観測を重みに使わない', () => { const data=samples(), base=weightsAt(data,modelIds,'temperature',cutoff,24,'2026-10-13T08:00:00Z'); const poisoned=data.map(s=>s.validTime>'2026-10-10'?{...s,observationAvailableAt:'2026-10-20T00:00:00Z',predicted:{...s.predicted,temperature:1e8}}:s); const reference=data.filter(s=>s.validTime<='2026-10-10');expect(weightsAt(poisoned,modelIds,'temperature',cutoff,24,'2026-10-13T08:00:00Z').weights).toEqual(weightsAt(reference,modelIds,'temperature',cutoff,24,'2026-10-13T08:00:00Z').weights);expect(base.weighted).toBe(true); });
  it('未取得の予報を重みに使わない', () => { const data=samples().map(s=>({...s,forecastAvailableAt:'2026-11-01T00:00:00Z'}));expect(weightsAt(data,modelIds,'temperature',cutoff,24,'2026-10-13T08:00:00Z').weighted).toBe(false); });
  it('未来の標本を加えても過去バックテストは不変', () => { const original=samples();const base=evaluate(original,modelIds,'temperature',cutoff,7,24,'demo',null);const future=original.slice(0,4).map(s=>({...s,validTime:'2026-10-13T00:00:00Z',decisionTime:'2026-10-12T12:00:00Z',observationAvailableAt:'2026-10-14T00:00:00Z'}));expect(evaluate([...original,...future],modelIds,'temperature',cutoff,7,24,'demo',null).baselines).toEqual(base.baselines); });
  it('各単独・平均・加重は同じ標本数', () => { const result=evaluate(samples(),modelIds,'temperature',cutoff,30,24,'demo',null);expect(result.baselines.length).toBe(6);expect(new Set(result.baselines.map(b=>b.count)).size).toBe(1);expect(result.commonCount).toBeGreaterThan(20); });
  it('過去runの初期化を公開時刻と扱わない', () => { const raw=samples().map(s=>({...s,method:'single-run' as const}));const result=evaluate(raw,modelIds,'temperature',cutoff,30,24,'single-run',null);expect(result.scores[0].sampleCount).toBeGreaterThan(0);expect(result.commonCount).toBe(0);expect(result.status).toContain('証跡'); });
  it('観測と予報の地点を一致させる', () => { const data=demoWeather(LOCATIONS[0],cutoff), hour=data.models[0].hours[1];const o={id:'o',locationId:'osaka',observedAt:hour.validTime,availableAt:cutoff,importedAt:cutoff,source:'demo',kind:'demo' as const,values:emptyValues()};expect(samplesFrom(data.models,[o])).toEqual([]); });
});
