export const VARIABLES = ['temperature', 'probability', 'precipitation', 'humidity', 'windSpeed', 'windDirection', 'weatherCode', 'pressure', 'cloud', 'radiation', 'cape'] as const;
export type Variable = typeof VARIABLES[number];
export type Values = Record<Variable, number | null>;
export type ModelId = 'jma' | 'ecmwf' | 'gfs' | 'icon';
export interface Location { id: string; name: string; latitude: number; longitude: number; timezone: string }
export type RunMethod = 'snapshot' | 'single-run' | 'previous-runs' | 'demo';
export interface ForecastRun {
  id: string; locationId: string; model: ModelId; initializationTime: string | null;
  issueTime: string | null; availableAt: string; retrievedAt: string; source: string; method: RunMethod;
}
export interface Forecast { runId: string; validTime: string; leadHours: number; leadBasis: 'availability' | 'initialization' | 'fixed-offset' | 'demo'; values: Values }
export interface ModelForecast { run: ForecastRun; hours: Forecast[]; missing: Variable[] }
export interface Observation { id: string; locationId: string; observedAt: string; availableAt: string; importedAt: string; source: string; kind: 'station' | 'demo'; values: Values }
export interface Sample { model: ModelId; validTime: string; decisionTime: string; forecastAvailableAt: string; observationAvailableAt: string; leadHours: number; method: RunMethod; predicted: Values; observed: Values }
export const LEADS = [1, 3, 6, 12, 24, 48, 72, 120, 168] as const;
export const WINDOWS = [7, 30, 90, 365] as const;
export interface ContinuousMetrics { count: number; mae: number | null; rmse: number | null; bias: number | null }
export interface CalibrationBin { lower: number; upper: number; count: number; predicted: number | null; observed: number | null }
export interface RainMetrics { count: number; rainCount: number; accuracy: number | null; precision: number | null; recall: number | null; f1: number | null; brier: number | null; alwaysDryAccuracy: number | null; climatologyBrier: number | null; calibration: CalibrationBin[] }
export interface Score { model: ModelId; variable: Variable; lead: number; days: number; season: number | null; metrics: ContinuousMetrics; rain: RainMetrics | null; decayedError: number | null; sampleCount: number }
export interface WeightInfo { weights: Partial<Record<ModelId, number>>; reason: string; sampleCount: number; historicalRmse: number | null; weighted: boolean }
export interface Uncertainty { spread: number | null; error: number | null; confidence: '低' | '中' | '高'; modelCount: number; disagreement: boolean }
export interface EnsemblePoint { validTime: string; values: Values; simple: Values; uncertainty: Record<Variable, Uncertainty>; weights: Record<Variable, WeightInfo>; confidence: '低' | '中' | '高'; temperatureSpread: number | null; temperatureError: number | null; disagreement: boolean; modelCount: number }
export interface Baseline { name: string; count: number; metrics: ContinuousMetrics; rain: RainMetrics | null }
export interface Evaluation {
  variable: Variable; lead: number; days: number; season: number | null; scores: Score[]; baselines: Baseline[];
  commonCount: number; excluded: number; trainingDays: number; status: string; method: 'snapshot' | 'single-run' | 'previous-runs' | 'demo'; cutoff: string;
}
export interface WeatherResponse { location: Location; mode: 'live' | 'demo'; fetchedAt: string; stale: boolean; models: ModelForecast[]; ensemble: EnsemblePoint[]; warnings: string[]; observation: Observation | null }
export const emptyValues = (): Values => Object.fromEntries(VARIABLES.map(v => [v, null])) as Values;
export const LOCATIONS: Location[] = [
  { id: 'tokyo', name: '東京', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { id: 'osaka', name: '大阪', latitude: 34.6937, longitude: 135.5023, timezone: 'Asia/Tokyo' },
  { id: 'sapporo', name: '札幌', latitude: 43.0618, longitude: 141.3545, timezone: 'Asia/Tokyo' },
  { id: 'fukuoka', name: '福岡', latitude: 33.5902, longitude: 130.4017, timezone: 'Asia/Tokyo' },
];
