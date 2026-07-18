import { defineConfig } from 'vite';

const nodeGlobal = globalThis as typeof globalThis & {
  process?: { env?: { VITE_BASE?: string } };
};

export default defineConfig({
  base: nodeGlobal.process?.env?.VITE_BASE ?? '/',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
