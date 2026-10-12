import { type EnsemblePoint, type Evaluation, type ForecastRun, type Location, type ModelForecast, type ModelId, type Observation, type RunMethod } from '../domain/types';
import { DAY } from '../domain/time';
export class Repository {
  constructor(private readonly db: D1Database) {}
  async location(id: string): Promise<Location | null> {
    const row = await this.db.prepare('SELECT * FROM locations WHERE id=?').bind(id).first<Location>(); return row ?? null;
  }
  async ensureLocation(location: Location) {
    await this.db.prepare('INSERT OR IGNORE INTO locations(id,name,latitude,longitude,timezone) VALUES(?,?,?,?,?)').bind(location.id, location.name, location.latitude, location.longitude, location.timezone).run();
  }
  private async batch(statements: D1PreparedStatement[]) { for (let i = 0; i < statements.length; i += 60) await this.db.batch(statements.slice(i, i + 60)); }
  async saveModels(models: ModelForecast[]) {
    for (const model of models) {
      const r = model.run;
      // Store all children and the parent in one transaction. Idempotent retry keeps the first snapshot.
      await this.db.batch([
        this.db.prepare('INSERT OR IGNORE INTO forecast_runs(id,location_id,model,initialization_time,issue_time,available_at,retrieved_at,source,method,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(r.id, r.locationId, r.model, r.initializationTime, r.issueTime, r.availableAt, r.retrievedAt, r.source, r.method, JSON.stringify({ missing: model.missing })),
        ...model.hours.map(h => this.db.prepare('INSERT OR IGNORE INTO forecasts(run_id,valid_time,lead_hours,lead_basis,values_json) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM forecast_runs WHERE id=? AND retrieved_at=?)').bind(r.id, h.validTime, h.leadHours, h.leadBasis, JSON.stringify(h.values), r.id, r.retrievedAt)),
      ]);
    }
  }
  async latestModels(locationId: string): Promise<ModelForecast[]> {
    const { results } = await this.db.prepare(`SELECT r.* FROM forecast_runs r WHERE r.location_id=? AND r.method='snapshot' AND r.id=(SELECT r2.id FROM forecast_runs r2 WHERE r2.location_id=r.location_id AND r2.model=r.model AND r2.method='snapshot' ORDER BY r2.retrieved_at DESC LIMIT 1)`).bind(locationId).all<Record<string, unknown>>();
    return Promise.all(results.map(async row => {
      const r: ForecastRun = { id: row.id as string, locationId, model: row.model as ModelId, initializationTime: row.initialization_time as string | null, issueTime: row.issue_time as string | null, availableAt: row.available_at as string, retrievedAt: row.retrieved_at as string, source: row.source as string, method: 'snapshot' };
      const hours = await this.db.prepare('SELECT * FROM forecasts WHERE run_id=? ORDER BY valid_time').bind(r.id).all<Record<string, unknown>>();
      return { run: r, missing: JSON.parse(row.metadata as string).missing ?? [], hours: hours.results.map(h => ({ runId: r.id, validTime: h.valid_time as string, leadHours: h.lead_hours as number, leadBasis: h.lead_basis as 'availability', values: JSON.parse(h.values_json as string) })) };
    }));
  }
  async observations(locationId: string, cutoff: string, days = 365): Promise<Observation[]> {
    const start = new Date(Date.parse(cutoff) - days * DAY).toISOString();
    const { results } = await this.db.prepare('SELECT * FROM observations WHERE location_id=? AND observed_at>=? AND observed_at<? ORDER BY observed_at').bind(locationId, start, cutoff).all<Record<string, unknown>>();
    return results.map(r => ({ id: r.id as string, locationId, observedAt: r.observed_at as string, availableAt: r.available_at as string, importedAt: r.imported_at as string, source: r.source as string, kind: 'station', values: JSON.parse(r.values_json as string) }));
  }
  async importObservations(observations: Observation[]): Promise<number> {
    let count = 0;
    for (let i = 0; i < observations.length; i += 60) {
      const result = await this.db.batch(observations.slice(i, i + 60).map(o => this.db.prepare('INSERT OR IGNORE INTO observations(id,location_id,observed_at,available_at,imported_at,source,kind,values_json) VALUES(?,?,?,?,?,?,?,?)').bind(o.id, o.locationId, o.observedAt, o.availableAt, o.importedAt, o.source, o.kind, JSON.stringify(o.values))));
      count += result.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
    }
    return count;
  }
  async history(locationId: string, cutoff: string, days: number, lead: number, method?: RunMethod): Promise<ModelForecast[]> {
    const start = new Date(Date.parse(cutoff) - days * DAY).toISOString();
    const { results } = await this.db.prepare(`SELECT r.*,f.valid_time,f.lead_hours,f.lead_basis,f.values_json FROM forecasts f JOIN forecast_runs r ON r.id=f.run_id WHERE r.location_id=? AND f.valid_time>=? AND f.valid_time<? AND r.available_at<=? AND f.lead_hours BETWEEN ? AND ? ${method ? 'AND r.method=?' : ''} ORDER BY r.available_at,f.valid_time LIMIT 40001`).bind(locationId, start, cutoff, cutoff, lead - 1, lead + 1, ...(method ? [method] : [])).all<Record<string, unknown>>();
    if (results.length > 40000) throw new Error('履歴が大きすぎます。期間を短くして再試行してください');
    const groups = new Map<string, ModelForecast>();
    for (const row of results) {
      const id = row.id as string;
      if (!groups.has(id)) groups.set(id, { run: { id, locationId, model: row.model as ModelId, initializationTime: row.initialization_time as string | null, issueTime: row.issue_time as string | null, availableAt: row.available_at as string, retrievedAt: row.retrieved_at as string, source: row.source as string, method: row.method as RunMethod }, missing: JSON.parse(row.metadata as string).missing ?? [], hours: [] });
      groups.get(id)!.hours.push({ runId: id, validTime: row.valid_time as string, leadHours: row.lead_hours as number, leadBasis: row.lead_basis as 'availability', values: JSON.parse(row.values_json as string) });
    }
    return [...groups.values()];
  }
  async saveEnsemble(locationId: string, generatedAt: string, points: EnsemblePoint[], runIds: string[]) {
    await this.batch(points.map(p => this.db.prepare('INSERT OR IGNORE INTO ensemble_forecasts(id,location_id,generated_at,valid_time,method,values_json,weights_json,uncertainty_json,run_ids_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(`${locationId}:${generatedAt}:${p.validTime}`, locationId, generatedAt, p.validTime, p.weights.temperature.weighted ? 'weighted' : 'simple', JSON.stringify(p.values), JSON.stringify(p.weights), JSON.stringify({ algorithmVersion: 'mvp-1', variables: p.uncertainty }), JSON.stringify(runIds))));
  }
  async saveEvaluation(locationId: string, evaluation: Evaluation, runIds: string[], observationIds: string[]) {
    await this.batch(evaluation.scores.map(score => this.db.prepare('INSERT OR IGNORE INTO model_scores(id,location_id,model,variable,lead_hours,window_days,season,calculated_at,method,metrics_json,run_ids_json,observation_ids_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(`${locationId}:${evaluation.cutoff}:${score.model}:${evaluation.variable}:${evaluation.lead}:${evaluation.days}:${evaluation.season}:${evaluation.method}`, locationId, score.model, evaluation.variable, evaluation.lead, evaluation.days, evaluation.season, evaluation.cutoff, evaluation.method, JSON.stringify({ ...score, algorithmVersion: 'mvp-1', baselines: evaluation.baselines, commonCount: evaluation.commonCount, excluded: evaluation.excluded }), JSON.stringify(runIds), JSON.stringify(observationIds))));
  }
}
