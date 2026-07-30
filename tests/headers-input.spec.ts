import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { SmartFetchBuilder } from '../src/factory.js';
import { SmartFetchError } from '../src/errors.js';
import type { FetchAdapter, HeadersInit } from '../src/types.js';

/**
 * Formas de entrada admitidas para las cabeceras de petición.
 *
 * Antes solo funcionaba `Record<string, string>`, y las otras dos formas nativas
 * fallaban **en silencio**: un `Headers` desaparecía y un array de pares se
 * corrompía en `{"0": ["X-B","2"]}`, produciendo una cabecera llamada `0`.
 * TypeScript las bloqueaba en compilación, así que solo se notaba desde
 * JavaScript o con un `as any`.
 *
 * Regla multi-valor: los valores de la petición para un nombre **reemplazan**
 * todos los del cliente para ese nombre; los duplicados se preservan dentro de un
 * mismo nivel.
 */
describe('cabeceras de petición: formas de entrada', () => {
  /** Captura el `RequestInit` con el que se llamó al adaptador. */
  function capturing() {
    const seen: { init?: RequestInit } = {};
    const fetchMock = jest.fn<FetchAdapter>(async (_url, init) => {
      seen.init = init;
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    return { seen, fetchMock };
  }

  /** Normaliza lo que llegó al adaptador a pares, para comparar entre formas. */
  function paresDe(init: RequestInit | undefined): [string, string][] {
    const pares: [string, string][] = [];
    new Headers(init?.headers).forEach((valor, nombre) => pares.push([nombre, valor]));
    return pares.sort();
  }

  describe('las tres formas nativas producen el mismo resultado', () => {
    const equivalentes: [string, HeadersInit][] = [
      ['Record', { 'X-A': '1', 'X-B': '2' }],
      [
        'array de pares',
        [
          ['X-A', '1'],
          ['X-B', '2'],
        ],
      ],
      ['Headers', new Headers({ 'X-A': '1', 'X-B': '2' })],
    ];

    it.each(equivalentes)('acepta %s', async (_nombre, headers) => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/a', { headers });

      expect(paresDe(seen.init)).toEqual([
        ['x-a', '1'],
        ['x-b', '2'],
      ]);
    });

    it('un Headers ya no desaparece', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/a', { headers: new Headers({ 'X-A': '1' }) });

      expect(paresDe(seen.init)).toEqual([['x-a', '1']]);
    });

    it('un array de pares ya no se corrompe en una clave numérica', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/a', { headers: [['X-B', '2']] });

      const nombres = paresDe(seen.init).map(([n]) => n);
      expect(nombres).toEqual(['x-b']);
      expect(nombres).not.toContain('0');
    });
  });

  describe('fusión cliente/petición en cada combinación de formas', () => {
    const formas: [string, (n: string, v: string) => HeadersInit][] = [
      ['Record', (n, v) => ({ [n]: v })],
      ['array', (n, v) => [[n, v]]],
      ['Headers', (n, v) => new Headers({ [n]: v })],
    ];

    for (const [nombreCliente, hazCliente] of formas) {
      for (const [nombrePeticion, hazPeticion] of formas) {
        it(`cliente ${nombreCliente} + petición ${nombrePeticion}: gana la petición`, async () => {
          const { seen, fetchMock } = capturing();
          const client = new SmartFetch(
            { headers: hazCliente('X-Token', 'viejo') },
            { fetch: fetchMock },
          );

          await client.get('https://api.x.com/a', { headers: hazPeticion('X-Token', 'nuevo') });

          expect(paresDe(seen.init)).toEqual([['x-token', 'nuevo']]);
        });
      }
    }

    it('conserva las del cliente que la petición no redefine', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch(
        { headers: new Headers({ Authorization: 'Bearer t', 'Accept-Language': 'es' }) },
        { fetch: fetchMock },
      );

      await client.get('https://api.x.com/a', { headers: [['Accept-Language', 'en']] });

      expect(paresDe(seen.init)).toEqual([
        ['accept-language', 'en'],
        ['authorization', 'Bearer t'],
      ]);
    });

    it('la fusión sigue sin distinguir mayúsculas', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch(
        { headers: { 'content-type': 'application/xml' } },
        { fetch: fetchMock },
      );

      await client.post('https://api.x.com/a', 'texto', {
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      expect(paresDe(seen.init)).toEqual([['content-type', 'application/json']]);
    });
  });

  describe('multi-valor', () => {
    it('preserva dos valores de la misma cabecera dentro de una petición', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/a', {
        headers: [
          ['Accept', 'application/xml'],
          ['Accept', 'text/plain'],
        ],
      });

      // `Headers` une los repetidos con coma, que es la forma canónica de una
      // cabecera de lista según el RFC: los dos valores están, ninguno se perdió.
      expect(new Headers(seen.init?.headers).get('accept')).toBe('application/xml, text/plain');
    });

    it('los valores de la petición reemplazan todos los del cliente para ese nombre', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch(
        { headers: { Accept: 'application/json' } },
        { fetch: fetchMock },
      );

      await client.get('https://api.x.com/a', {
        headers: [
          ['Accept', 'application/xml'],
          ['Accept', 'text/plain'],
        ],
      });

      const accept = new Headers(seen.init?.headers).get('accept');
      expect(accept).toBe('application/xml, text/plain');
      expect(accept).not.toContain('application/json');
    });

    it('un Headers con append también conserva los dos valores', async () => {
      const { seen, fetchMock } = capturing();
      const headers = new Headers();
      headers.append('Accept', 'application/xml');
      headers.append('Accept', 'text/plain');
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/a', { headers });

      expect(new Headers(seen.init?.headers).get('accept')).toBe('application/xml, text/plain');
    });
  });

  describe('entradas inválidas', () => {
    it.each([
      ['un número', 42],
      ['null', null],
      ['una cadena', 'X-A: 1'],
      ['un booleano', true],
      ['un array de algo que no son pares', [['solo-uno']]],
      ['un array con un elemento que no es array', ['X-A', '1']],
      ['un par con nombre que no es string', [[42, 'x']]],
      ['un par con valor no primitivo', [['X-A', {}]]],
      ['un objeto con un valor que es objeto', { 'X-A': {} }],
      ['un objeto con un valor null', { 'X-A': null }],
    ])('rechaza %s con SmartFetchError', async (_desc, entrada) => {
      const { fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      const error = await client
        .get('https://api.x.com/a', { headers: entrada as HeadersInit })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SmartFetchError);
      expect((error as SmartFetchError).type).toBe('request');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('el mensaje dice qué se esperaba', async () => {
      const client = new SmartFetch({}, { fetch: capturing().fetchMock });

      const error = await client
        .get('https://api.x.com/a', { headers: 42 as unknown as HeadersInit })
        .catch((e: unknown) => e);

      expect((error as SmartFetchError).message).toMatch(/headers/i);
      expect((error as SmartFetchError).message).toMatch(/Headers/);
    });

    it('nunca descarta una entrada inválida en silencio', async () => {
      const { fetchMock } = capturing();
      const client = new SmartFetch(
        { headers: 42 as unknown as HeadersInit },
        { fetch: fetchMock },
      );

      await expect(client.get('https://api.x.com/a')).rejects.toBeInstanceOf(SmartFetchError);
    });
  });

  describe('el builder acepta las mismas formas', () => {
    it('headers() admite un Headers', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetchBuilder()
        .headers(new Headers({ 'X-A': '1' }))
        .adapter(fetchMock)
        .build();

      await client.get('https://api.x.com/a');

      expect(paresDe(seen.init)).toEqual([['x-a', '1']]);
    });

    it('header() y headers() se combinan sin duplicar por mayúsculas', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetchBuilder()
        .header('x-token', 'viejo')
        .headers([['X-Token', 'nuevo']])
        .adapter(fetchMock)
        .build();

      await client.get('https://api.x.com/a');

      expect(paresDe(seen.init)).toEqual([['x-token', 'nuevo']]);
    });
  });

  describe('Content-Type automático', () => {
    it('no añade el suyo si ya hay uno en un Headers', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.post(
        'https://api.x.com/a',
        { a: 1 },
        { headers: new Headers({ 'CONTENT-TYPE': 'application/vnd.custom+json' }) },
      );

      expect(new Headers(seen.init?.headers).get('content-type')).toBe(
        'application/vnd.custom+json',
      );
    });

    it('lo añade cuando no hay ninguno', async () => {
      const { seen, fetchMock } = capturing();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.post('https://api.x.com/a', { a: 1 }, { headers: [['X-A', '1']] });

      expect(new Headers(seen.init?.headers).get('content-type')).toBe('application/json');
    });
  });
});
