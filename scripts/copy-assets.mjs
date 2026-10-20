import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const dir of ['prompts', 'templates']) {
  await mkdir(path.join(root, 'dist', dir), { recursive: true });
  await cp(path.join(root, 'src', dir), path.join(root, 'dist', dir), {
    recursive: true,
  });
}

console.log('Copied prompts and templates into dist/.');
