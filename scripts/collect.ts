import { getPlatformProxy } from 'wrangler';
import worker, { type Env } from '../worker/index';
const platform = await getPlatformProxy<Env>({ persist: true, remoteBindings: false });
try { await worker.scheduled({} as ScheduledController, platform.env); console.log('Collection attempted. Check /api/weather and its warnings for each location.'); } finally { await platform.dispose(); }
