import { VERSION } from '../src/index.js';

/**
 * Smoke test del scaffolding: confirma que el toolchain de pruebas
 * (Jest + ts-jest en modo ESM) compila y ejecuta TypeScript correctamente.
 */
describe('scaffolding', () => {
  it('expone la versión de la librería', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toBe('0.1.0');
  });
});
