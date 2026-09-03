import { defineConfig } from 'tsdown'

/**
 * Node-only host package. The capture plugin builds as the default ESM
 * entry; the SQLite provider (the `./sqlite-provider` export the bundle's
 * `token-usage-sqlite` row names) builds as its own entry so it carries its
 * `node:sqlite` import without forcing it on the capture plugin's consumers;
 * the Remote service (the `./remote` export the `token-usage-remote` row
 * names) builds as its own entry so it carries its
 * `@deepseek-ai/dsh-typert-protocol` import without forcing it on the
 * capture plugin's consumers.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { 'sqlite-provider': 'lib/types/sqlite-provider.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { remote: 'lib/types/remote.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
