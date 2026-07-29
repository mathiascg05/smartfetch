/**
 * Configuración de Jest con ts-jest en modo ESM.
 * testEnvironment "node" porque la librería corre sobre el fetch de Node 18+.
 *
 * @type {import('jest').Config}
 */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
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
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
  // Full coverage is a property of this library, not an aspiration: CI runs
  // `test:coverage`, so any uncovered branch fails the build rather than
  // silently eroding the number.
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
