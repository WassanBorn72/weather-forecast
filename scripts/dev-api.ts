import { createServer } from 'node:http';
import { getPlatformProxy } from 'wrangler';
import worker, { type Env } from '../worker/index';
const platform = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: true, remoteBindings: false });
const port = Number(process.env.WEATHER_API_PORT ?? 8787);
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 250_000) { outgoing.writeHead(413, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: '取り込みは250KB以下です' })); return; } chunks.push(chunk); }
    const method = incoming.method ?? 'GET', headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, { method, headers, body: ['GET','HEAD'].includes(method) ? undefined : Buffer.concat(chunks) });
    const response = await worker.fetch(request, platform.env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: 'ローカルAPI処理に失敗しました' })); }
});
server.listen(port, '127.0.0.1', () => console.log(`Weather API ready on port ${port} (D1 local, native fetch with environment proxy)`));
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => { server.close(() => { void platform.dispose().then(() => process.exit(0)); }); });
