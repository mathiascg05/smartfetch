import { jest } from '@jest/globals';
import type { SmartFetchError } from '../src/errors.js';

/**
 * La librería debe poder **importarse** siempre, incluso en un runtime sin
 * `fetch` global.
 *
 * El caso existe precisamente para el adaptador inyectable: quien no tenga
 * `fetch` nativo pasará el suyo por `options.fetch`. Si el módulo explota al
 * cargarse, nunca llega a tener la oportunidad. El fallo solo debe aparecer al
 * intentar **usar** un cliente sin `fetch` disponible.
 */
describe('importación sin fetch global', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.resetModules();
  });

  it('el módulo se importa sin lanzar aunque no haya fetch global', async () => {
    // @ts-expect-error se elimina deliberadamente para simular un runtime sin fetch
    delete globalThis.fetch;
    jest.resetModules();

    await expect(import('../src/index.js')).resolves.toBeDefined();
  });

  it('expone el singleton y el export por defecto tras importar sin fetch', async () => {
    // @ts-expect-error se elimina deliberadamente para simular un runtime sin fetch
    delete globalThis.fetch;
    jest.resetModules();

    const mod = await import('../src/index.js');
    expect(typeof mod.smartfetch.get).toBe('function');
    expect(mod.default).toBe(mod.smartfetch);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('falla solo al usar el singleton sin fetch disponible', async () => {
    // @ts-expect-error se elimina deliberadamente para simular un runtime sin fetch
    delete globalThis.fetch;
    jest.resetModules();

    // El error se toma del MISMO módulo recargado: tras `resetModules()` la clase
    // del import estático es una instancia distinta y `instanceof` no casaría.
    const { smartfetch, SmartFetchError: Recargado } = await import('../src/index.js');
    const error = await smartfetch.get('https://api.x.com/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Recargado);
    expect((error as SmartFetchError).type).toBe('request');
    expect((error as SmartFetchError).message).toMatch(/fetch/i);
  });

  it('el singleton funciona con normalidad cuando sí hay fetch global', async () => {
    globalThis.fetch = async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    jest.resetModules();

    const { smartfetch } = await import('../src/index.js');
    const res = await smartfetch.get<{ ok: boolean }>('https://api.x.com/x');
    expect(res.data).toEqual({ ok: true });
  });
});
