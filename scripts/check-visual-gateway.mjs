import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const file of readdirSync(new URL('../server/', import.meta.url)).filter(name => name.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', new URL(`../server/${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Visual gateway syntax OK.');
