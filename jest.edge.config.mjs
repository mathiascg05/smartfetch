/**
 * Configuración de Jest para el runtime edge.
 *
 * Se mantiene aparte de `jest.config.mjs` a propósito: el runner, el transform y
 * la forma de escribir los tests son los mismos, pero el `testEnvironment` no, y
 * separarlo evita tocar ni la configuración de cobertura de Node ni la de Stryker,
 * que apunta a la principal.
 *
 * `@edge-runtime/jest-environment` ejecuta las pruebas dentro de un sandbox con
 * las globales que definen los runtimes edge (Cloudflare Workers, Vercel Edge) y
 * **sin** los módulos internos de Node. Eso es justamente lo que se quiere
 * comprobar: que la librería no depende de ninguno.
 *
 * @type {import('jest').Config}
 */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: '@edge-runtime/jest-environment',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/tests/edge'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  // La cobertura se mide en la corrida de Node, que ejerce la superficie
  // completa; aquí lo que se verifica es la compatibilidad con el runtime.
  collectCoverage: false,
};
