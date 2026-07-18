import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const limit = 10 * 1024 * 1024;
const root = 'dist';

async function sizeOf(path) {
  const info = await stat(path);
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map((entry) => sizeOf(join(path, entry))));
  return sizes.reduce((sum, value) => sum + value, 0);
}

const bytes = await sizeOf(root);
const mib = bytes / 1024 / 1024;
console.log(`dist size: ${mib.toFixed(2)} MiB (${bytes} bytes)`);

if (bytes > limit) {
  console.error('Bundle exceeds the 10 MiB project limit.');
  process.exit(1);
}
