import { emptyValues, type Location, type Observation } from '../domain/types';
import { DAY, utc } from '../domain/time';
export const NOAA_STATIONS: Record<string, string> = { tokyo: '47662099999', osaka: '47772099999', sapporo: '47412099999', fukuoka: '47807099999' };
const acceptedQuality = new Set(['0','1','4','5']);
function scalar(value: unknown, missing: string, divisor: number): number | null {
  if (typeof value !== 'string') return null;
  const [raw, quality] = value.split(',');
  if (!acceptedQuality.has(quality) || raw.replace(/^[+-]/,'') === missing) return null;
  const n = Number(raw); return Number.isFinite(n) ? n / divisor : null;
}
export function distanceKm(a: {latitude:number;longitude:number}, b: {latitude:number;longitude:number}) {
  const rad = (v:number)=>v*Math.PI/180;
  const h = Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function noaaUrl(station: string, start: string, end: string): URL {
  if (!/^\d{11}$/.test(station)) throw new Error('NOAA観測所IDは11桁です');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('観測期間はYYYY-MM-DDです');
  const a=Date.parse(start),b=Date.parse(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||b-a>30*DAY||b>Date.now())throw new Error('NOAA観測は過去の31日以内の期間を指定してください');
  const url=new URL('https://www.ncei.noaa.gov/access/services/data/v1');
  url.search=new URLSearchParams({dataset:'global-hourly',stations:station,startDate:start,endDate:end,format:'json',includeAttributes:'true',units:'metric'}).toString();
  return url;
}
export function parseNoaa(payload: unknown, station: string, location: Location, importedAt: string): Observation[] {
  if(!Array.isArray(payload))throw new Error('NOAAレスポンスの形式が不正です');
  const observations=new Map<string,Observation>();
  for(const row of payload){
    if(!row||typeof row!=='object'||String(row.STATION)!==station||typeof row.DATE!=='string')continue;
    const lat=Number(row.LATITUDE),lon=Number(row.LONGITUDE);
    if(row.LATITUDE==null||row.LONGITUDE==null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)continue;
    const distance=distanceKm(location,{latitude:lat,longitude:lon});
    if(distance>25)throw new Error('観測所は指定地点から25km以上離れています。観測所の近くを指定してください');
    const observedAt=utc(/(Z|[+-]\d\d:\d\d)$/.test(row.DATE)?row.DATE:`${row.DATE}Z`);
    // ISD DATE is UTC. Never round a report to a different forecast validation time.
    if(!observedAt.endsWith(':00:00.000Z')||observedAt>importedAt)continue;
    const values=emptyValues(),temp=scalar(row.TMP,'9999',10),dew=scalar(row.DEW,'9999',10);
    values.temperature=temp!==null&&temp>=-100&&temp<=70?temp:null;
    values.pressure=scalar(row.SLP,'99999',10);
    if(values.pressure!==null&&(values.pressure<500||values.pressure>1200))values.pressure=null;
    if(temp!==null&&dew!==null&&dew<=temp&&dew>-100&&temp<70)values.humidity=Math.min(100,Math.max(0,100*Math.exp(17.625*dew/(243.04+dew)-17.625*temp/(243.04+temp))));
    if(typeof row.WND==='string'){
      const [direction,directionQuality,,speed,speedQuality]=row.WND.split(',');
      if(direction!=='999'&&acceptedQuality.has(directionQuality)&&Number(direction)>=0&&Number(direction)<=360)values.windDirection=Number(direction)%360;
      if(speed!=='9999'&&acceptedQuality.has(speedQuality)&&Number(speed)>=0)values.windSpeed=Number(speed)/10;
    }
    // AA1..AA4 can be 1/3/6/24h accumulations. Only exact 1h measured totals are comparable.
    for(const field of ['AA1','AA2','AA3','AA4'])if(typeof row[field]==='string'){
      const [duration,depth,condition,quality]=row[field].split(',');
      if(duration==='01'&&depth!=='9999'&&condition!=='2'&&condition!=='9'&&acceptedQuality.has(quality)&&Number(depth)>=0){values.precipitation=Number(depth)/10;break;}
    }
    if(!Object.values(values).some(v=>v!==null))continue;
    const source=`NOAA NCEI Global Hourly / ${station} / ${String(row.NAME??'station').slice(0,100)} / ${lat},${lon} / 地点から${distance.toFixed(1)}km（湿度は気温・露点から算出）`;
    const observation:Observation={id:crypto.randomUUID(),locationId:location.id,observedAt,availableAt:importedAt,importedAt,source,kind:'station',values};
    const prior=observations.get(observedAt);
    if(!prior||Object.values(prior.values).filter(v=>v!==null).length<Object.values(values).filter(v=>v!==null).length)observations.set(observedAt,observation);
  }
  return [...observations.values()].sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
}
export async function fetchNoaa(location:Location,station:string,start:string,end:string):Promise<Observation[]>{
  const response=await fetch(noaaUrl(station,start,end),{signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`NOAA NCEI HTTP ${response.status}`);
  const text=await response.text();if(text.length>2_000_000)throw new Error('観測レスポンスが大きすぎます。期間を短くしてください');
  const observations=parseNoaa(JSON.parse(text),station,location,new Date().toISOString());
  if(!observations.length)throw new Error('品質検査に合格した毎正時の実測がありません。期間・観測所・公開遅延を確認してください');
  return observations;
}
