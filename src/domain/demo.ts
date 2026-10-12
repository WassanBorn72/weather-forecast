import { emptyValues, LEADS, type Location, type ModelForecast, type Sample, type Values, type WeatherResponse } from './types';
import { MODELS } from '../providers/models';
import { DAY, HOUR } from './time';
import { buildEnsemble } from './ensemble';
function truth(time: number, location: Location): Values {
  const day = Math.floor(time / DAY), hour = new Date(time).getUTCHours(), wet = Math.sin(day * 1.71) > 0.3;
  return { ...emptyValues(), temperature: 20 + (location.latitude - 35) * -0.6 + 4 * Math.sin((hour - 2) * Math.PI / 12) + 2 * Math.sin(day / 9), probability: null, precipitation: wet && hour > 4 && hour < 12 ? 0.4 + Math.abs(Math.sin(day)) * 3 : 0, humidity: 58 + (wet ? 22 : 0), windSpeed: 2 + Math.abs(Math.sin(day / 3)) * 2, windDirection: (day * 37) % 360, weatherCode: wet ? 61 : hour % 4 === 0 ? 2 : 1, pressure: 1014 + 5 * Math.sin(day / 4), cloud: wet ? 85 : 25, radiation: Math.max(0, 600 * Math.sin((hour + 9 - 6) * Math.PI / 12)), cape: wet ? 350 : 50 };
}
function prediction(actual: Values, index: number, time: number, lead: number): Values {
  const wave = Math.sin(time / DAY * 2.6 + index), error = [1.1, 0.65, 1.65, 1.3][index] * (1 + lead / 180);
  return { ...actual, temperature: actual.temperature! + error * wave + [0.3, -0.1, 0.6, -0.3][index], probability: Math.max(0.03, Math.min(0.97, (actual.precipitation! >= 0.1 ? 0.83 : 0.12) + error * wave * 0.13)), precipitation: Math.max(0, actual.precipitation! + error * wave * 0.5), humidity: Math.min(100, Math.max(0, actual.humidity! + error * wave * 5)), windSpeed: Math.max(0, actual.windSpeed! + error * wave * 0.6), windDirection: (actual.windDirection! + error * wave * 15 + 360) % 360 };
}
export function demoSamples(location: Location, now: string): Sample[] {
  const base = Math.floor(Date.parse(now) / DAY) * DAY, samples: Sample[] = [];
  for (let day = 1; day <= 365; day++) {
    const time = base - day * DAY + 3 * HOUR, validTime = new Date(time).toISOString(), actual = truth(time, location);
    for (const lead of LEADS) for (let i = 0; i < MODELS.length; i++) {
      const decision = new Date(time - lead * HOUR).toISOString();
      samples.push({ model: MODELS[i].id, validTime, decisionTime: decision, forecastAvailableAt: decision, observationAvailableAt: new Date(time + HOUR).toISOString(), leadHours: lead, method: 'demo', predicted: prediction(actual, i, time, lead), observed: actual });
    }
  }
  return samples;
}
export function demoWeather(location: Location, now = new Date().toISOString()): WeatherResponse {
  const base = Math.floor(Date.parse(now) / HOUR) * HOUR;
  const models: ModelForecast[] = MODELS.map((model, i) => {
    const id = `demo-${model.id}`;
    return { run: { id, locationId: location.id, model: model.id, initializationTime: null, issueTime: null, availableAt: now, retrievedAt: now, source: '合成デモデータ（実際の予報ではありません）', method: 'demo' }, missing: [], hours: Array.from({ length: 168 }, (_, h) => { const time = base + h * HOUR; return { runId: id, validTime: new Date(time).toISOString(), leadHours: h, leadBasis: 'demo', values: prediction(truth(time, location), i, time, h) }; }) };
  });
  return { location, mode: 'demo', fetchedAt: now, stale: false, models, ensemble: buildEnsemble(models, demoSamples(location, now), now), warnings: ['デモの予報・実測・精度・重みはすべて合成データです。実モデルの優劣を示しません。'], observation: null };
}
