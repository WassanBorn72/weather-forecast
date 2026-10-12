import { MODELS } from '../src/providers/models';
import { LOCATIONS } from '../src/domain/types';
import { OpenMeteoProvider } from '../src/providers/openmeteo';
const provider = new OpenMeteoProvider();
let failed = 0;
for (const model of MODELS) {
  try {
    const forecast = await provider.fetch(LOCATIONS[0], model);
    const temperatureCount = forecast.hours.filter(h => h.values.temperature !== null).length;
    if (temperatureCount < 24) throw new Error('24時間分の気温がありません');
    console.log(`${model.label}: ${temperatureCount} hours; missing: ${forecast.missing.join(', ') || 'none'}`);
  } catch (e) { failed++; console.error(`${model.label}: ${e instanceof Error ? e.message : 'failed'}`); }
}
if (failed) process.exitCode = 1;
