import { VERSION } from '../src/index.js';

/**
 * Smoke test del scaffolding: confirma que el toolchain de pruebas
 * (Jest + ts-jest en modo ESM) compila y ejecuta TypeScript correctamente.
 */
describe('scaffolding', () => {
  it('expone la versión de la librería', () => {
    expect(typeof VERSION).toBe('string');
    // Se valida el formato semver en lugar de una versión concreta, para que la
    // prueba no haya que tocarla en cada release.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
