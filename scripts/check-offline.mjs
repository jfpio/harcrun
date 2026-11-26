import { readFileSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';
const sw = readFileSync('dist/sw.js', 'utf8');
new Script(sw);
if (sw.includes('const PRECACHE = [];') || sw.includes("'harcrun-shell-v1'"))
  throw new Error('Service worker nie zawiera wersji lub listy plików.');
for (const asset of readdirSync('dist/assets'))
  if (!sw.includes(`/assets/${asset}`)) throw new Error(`Brak pliku offline: ${asset}`);
console.log('Offline: wszystkie skrypty, style i fonty uwzględnione w precache.');
