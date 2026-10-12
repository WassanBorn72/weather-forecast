import { type ModelId, type Variable } from '../domain/types';
export interface ModelDefinition { id: ModelId; label: string; apiModel: string; color: string; variables: Variable[]; singleRunVariables?: Variable[]; probabilitySource?: string }
const common: Variable[] = ['temperature', 'precipitation', 'humidity', 'windSpeed', 'windDirection', 'weatherCode', 'pressure', 'cloud', 'radiation'];
export const MODELS: ModelDefinition[] = [
  { id: 'jma', label: 'JMA GSM', apiModel: 'jma_gsm', color: '#c18951', variables: common },
  { id: 'ecmwf', label: 'ECMWF IFS', apiModel: 'ecmwf_ifs025', color: '#397a74', variables: [...common, 'cape'] },
  { id: 'gfs', label: 'GFS', apiModel: 'gfs_global', color: '#6287b6', variables: [...common, 'cape', 'probability'], singleRunVariables: [...common, 'cape'], probabilitySource: 'Open-Meteoのアンサンブル由来確率' },
  { id: 'icon', label: 'ICON', apiModel: 'icon_global', color: '#9375a3', variables: [...common, 'cape'] },
];
export const modelName = (id: string) => MODELS.find(m => m.id === id)?.label ?? id;
export const FIELDS: Record<Variable, { api: string; label: string; unit: string; scale: number }> = {
  temperature: { api: 'temperature_2m', label: '気温', unit: '℃', scale: 2 },
  probability: { api: 'precipitation_probability', label: '降水確率', unit: '%', scale: 1 },
  precipitation: { api: 'precipitation', label: '降水量', unit: 'mm', scale: 1 },
  humidity: { api: 'relative_humidity_2m', label: '湿度', unit: '%', scale: 10 },
  windSpeed: { api: 'wind_speed_10m', label: '風速', unit: 'm/s', scale: 2 },
  windDirection: { api: 'wind_direction_10m', label: '風向', unit: '°', scale: 45 },
  weatherCode: { api: 'weather_code', label: '天気状態', unit: '', scale: 1 },
  pressure: { api: 'pressure_msl', label: '気圧', unit: 'hPa', scale: 5 },
  cloud: { api: 'cloud_cover', label: '雲量', unit: '%', scale: 20 },
  radiation: { api: 'shortwave_radiation', label: '日射量', unit: 'W/m²', scale: 100 },
  cape: { api: 'cape', label: 'CAPE', unit: 'J/kg', scale: 500 },
};
