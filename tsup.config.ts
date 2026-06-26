import { defineConfig } from 'tsup';

/**
 * Build de la librería: genera ESM (.js) + CJS (.cjs) + tipos (.d.ts) en dist/.
 * Sin dependencias externas en el bundle (la librería usa solo fetch nativo).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'es2021',
});
