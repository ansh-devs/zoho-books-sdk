import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'gst/index': 'src/gst/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'node18',
  platform: 'node',
});
