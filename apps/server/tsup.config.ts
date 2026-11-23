import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Bundle every npm dependency (hono, zod, @car-record/shared which ships raw TS, ...)
  // so the runtime image only needs dist/. Node builtins (node:sqlite, node:fs, ...)
  // stay external automatically because platform is 'node'.
  noExternal: [/.*/],
  // Bundled CJS deps may call require(); give ESM output a real require.
  banner: {
    js: "import { createRequire as __cr_createRequire } from 'node:module'; const require = __cr_createRequire(import.meta.url);",
  },
});
