import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).filter(f => !f.endsWith('.map')).map(f => `/assets/${f}`);
const precache = ['/', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', ...assets];
const source = await readFile('public/sw.js', 'utf8');
const hash = createHash('sha256').update(source);
for (const path of precache) hash.update(path).update(await readFile(`dist${path === '/' ? '/index.html' : path}`));
const build = hash.digest('hex').slice(0, 12);
await writeFile('dist/sw.js', source.replace('__BUILD__', build).replace('__PRECACHE__', JSON.stringify(precache)));
