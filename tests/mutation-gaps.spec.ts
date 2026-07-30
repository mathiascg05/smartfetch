import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { CancelledError, HttpError, NetworkError } from '../src/errors.js';
import { buildURL } from '../src/url.js';
import { parseRetryAfter } from '../src/retry/retry-after.js';
import { defaultShouldRetry, withRetry } from '../src/retry/retry.js';
import { InterceptorManager } from '../src/interceptors.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Huecos de verificación encontrados por mutation testing (StrykerJS).
 *
 * Cada bloque mata un mutante que sobrevivía pese al 100% de cobertura de
 * líneas: el código se ejecutaba, pero ninguna aserción comprobaba **el valor
 * concreto** que produce. Son exactamente el tipo de hueco que dejó pasar los
 * nueve bugs de comportamiento anteriores.
 */
describe('huecos detectados por mutation testing', () => {
  function jsonAdapter(body: unknown, init: ResponseInit = { status: 200 }) {
    return jest.fn<FetchAdapter>(
      async () =>
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
          ...init,
        }),
    );
  }

  describe('borde superior del rango aceptado (isStatusAccepted)', () => {
    // Mutante: `status < 300` -> `status <= 300`. Sobrevivía porque ningún test
    // usaba exactamente 300.
    it('rechaza un 300 con la política por defecto', async () => {
      const client = new SmartFetch({}, { fetch: jsonAdapter({}, { status: 300 }) });

      const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(300);
    });

    it('acepta un 299', async () => {
      const client = new SmartFetch({}, { fetch: jsonAdapter({ ok: true }, { status: 299 }) });

      const res = await client.get('https://api.x.com/x');

      expect(res.status).toBe(299);
      expect(res.ok).toBe(true);
    });

    it('rechaza un 199', async () => {
      // `new Response(..., { status: 199 })` lanza: el constructor solo admite
      // 200-599. Se simula la respuesta para poder probar el borde inferior.
      const respuesta = {
        status: 199,
        statusText: 'Informational',
        ok: false,
        url: '',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{}',
      } as unknown as Response;
      const client = new SmartFetch({}, { fetch: async () => respuesta });

      const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(199);
    });
  });

  describe('el cuerpo nunca viaja en un GET', () => {
    // Mutante: `config.body !== undefined && config.method !== 'GET'` -> `||`.
    // Sobrevivía porque nadie pasaba un body a un GET.
    it('ignora un body pasado por config en un GET', async () => {
      const fetchMock = jsonAdapter({});
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/x', { body: { no: 'debería viajar' } });

      expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    });

    it('sí envía el body en un POST', async () => {
      const fetchMock = jsonAdapter({});
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.post('https://api.x.com/x', { sí: 'viaja' });

      expect(fetchMock.mock.calls[0][1]?.body).toBe('{"sí":"viaja"}');
    });
  });

  describe('hasHeader compara sin distinguir mayúsculas', () => {
    // Mutante: `name.toLowerCase()` -> `toUpperCase()`. Sobrevivía porque las
    // cabeceras de los tests ya estaban en minúsculas.
    it('no añade un Content-Type propio si ya hay uno en MAYÚSCULAS', async () => {
      const fetchMock = jsonAdapter({});
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.post(
        'https://api.x.com/x',
        { a: 1 },
        { headers: { 'CONTENT-TYPE': 'application/vnd.custom+json' } },
      );

      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      const claves = Object.keys(headers).filter((k) => k.toLowerCase() === 'content-type');
      expect(claves).toHaveLength(1);
      expect(headers[claves[0]]).toBe('application/vnd.custom+json');
    });

    it('añade el suyo cuando no hay ninguno', async () => {
      const fetchMock = jsonAdapter({});
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.post('https://api.x.com/x', { a: 1 });

      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('isAbortError solo reconoce abortos reales', () => {
    // Mutantes: las tres guardas de `typeof error === 'object' && error !== null
    // && 'name' in error`. Sobrevivían porque ningún test hacía fallar al
    // adaptador con algo que no fuera un objeto con `name`.
    it.each([
      ['un string', 'se rompió'],
      ['null', null],
      ['un número', 42],
      ['un objeto sin name', { algo: 'raro' }],
      ['un error con otro name', Object.assign(new Error('x'), { name: 'OtroError' })],
    ])('trata %s como error de red, no como cancelación', async (_desc, lanzado) => {
      // Rechazar con un valor que no es Error es precisamente lo que se prueba:
      // el adaptador lo aporta quien consume la librería y puede lanzar de todo.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const client = new SmartFetch({ timeout: 5000 }, { fetch: () => Promise.reject(lanzado) });

      const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NetworkError);
      expect(error).not.toBeInstanceOf(CancelledError);
      expect((error as NetworkError).cause).toBe(lanzado);
    });
  });

  describe('mensajes de error', () => {
    // Mutantes StringLiteral -> "". Los mensajes son parte de la experiencia de
    // quien depura, así que se afirman explícitamente.
    it('el NetworkError de un cuerpo truncado explica qué pasó', async () => {
      const respuesta = {
        status: 200,
        statusText: 'OK',
        ok: true,
        url: '',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.reject(new TypeError('terminated')),
      } as unknown as Response;
      const client = new SmartFetch({}, { fetch: async () => respuesta });

      const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

      expect((error as NetworkError).message).toMatch(/connection closed/i);
      expect((error as NetworkError).message).toMatch(/body/i);
    });

    it('el CancelledError por defecto nombra la cancelación', () => {
      expect(new CancelledError().message).toMatch(/cancelled/i);
    });

    it('el error de red genérico nombra la red', async () => {
      const client = new SmartFetch({}, { fetch: () => Promise.reject(new Error('boom')) });

      const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

      expect((error as NetworkError).message).toMatch(/network/i);
    });
  });
});

/**
 * Segunda ronda de huecos detectados por mutation testing, tras añadir HEAD,
 * OPTIONS, el passthrough de RequestInit y el centinela de totalTimeout.
 */
describe('huecos detectados por mutation testing (ronda 2)', () => {
  describe('buildURL: los regex necesitan sus anclas', () => {
    // Mutante: `/^https?:\/\//i` -> `/https?:\/\//i`. Sin el ancla, una ruta
    // relativa que contenga "http://" en cualquier posición se trataría como
    // absoluta y la baseURL se perdería en silencio.
    it('una ruta relativa que contiene http:// sigue siendo relativa', () => {
      const url = buildURL({
        baseURL: 'https://api.x.com',
        url: '/redirect?to=http://otro.com',
      });

      expect(url.startsWith('https://api.x.com/redirect')).toBe(true);
    });

    // Mutante: `/^https?:\/\//i` -> `/^https:\/\//i`.
    it('una URL absoluta http:// se respeta igual que https://', () => {
      expect(buildURL({ baseURL: 'https://api.x.com', url: 'http://otro.com/x' })).toBe(
        'http://otro.com/x',
      );
    });

    // Mutantes: `/\/+$/` -> `/\/$/` y `/^\/+/` -> `/^\//`.
    it('normaliza barras repetidas al unir baseURL y ruta', () => {
      expect(buildURL({ baseURL: 'https://api.x.com//', url: '/p' })).toBe('https://api.x.com/p');
      expect(buildURL({ baseURL: 'https://api.x.com', url: '///p' })).toBe('https://api.x.com/p');
    });

    // Mutantes: `hashIndex >= 0` y `queryIndex >= 0` -> `> 0`. Se rompen cuando el
    // carácter aparece en la posición 0.
    it('trata un fragmento en la posición 0', () => {
      expect(buildURL({ url: '#frag', params: { a: 1 } })).toBe('?a=1#frag');
    });

    it('trata una query en la posición 0', () => {
      expect(buildURL({ url: '?x=1', params: { a: 2 } })).toBe('?x=1&a=2');
    });
  });

  describe('parseRetryAfter: el formato en segundos está anclado por ambos lados', () => {
    // Mutante: `/^\d+$/` -> `/^\d+/`. Sin el ancla final, "12abc" se leería como
    // 12 segundos en vez de rechazarse.
    it('rechaza un valor que empieza por dígitos pero no lo es entero', () => {
      expect(parseRetryAfter('12abc')).toBeNull();
      expect(parseRetryAfter('3.5')).toBeNull();
    });

    // Mutantes sobre `value.trim()` y sobre la comprobación de cadena vacía.
    it('ignora los espacios alrededor del valor', () => {
      expect(parseRetryAfter('  120  ')).toBe(120_000);
    });

    it('trata una cadena de solo espacios como ilegible', () => {
      expect(parseRetryAfter('   ')).toBeNull();
    });
  });

  describe('withRetry: bordes del motor', () => {
    // Mutante: `error.status <= 599` -> `< 599`.
    it('reintenta un 599, el último código del rango 5xx', () => {
      expect(defaultShouldRetry(new HttpError(599, 'Network Connect Timeout'))).toBe(true);
      expect(defaultShouldRetry(new HttpError(600, 'Fuera de rango'))).toBe(false);
    });

    // Mutante: quitar el encadenamiento opcional de `error.response?.headers`.
    // Un HttpError sin `response` haría estallar el motor en vez de caer al backoff.
    it('tolera un HttpError 429 que no trae respuesta adjunta', async () => {
      const operation = jest.fn(async () => {
        throw new HttpError(429, 'Too Many Requests');
      });

      await expect(
        withRetry(operation, { retries: 1, shouldRetry: () => true }),
      ).rejects.toBeInstanceOf(HttpError);
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('InterceptorManager arranca vacío', () => {
    // Mutante: `handlers = []` -> `["Stryker was here"]`.
    it('un gestor recién creado no recorre ningún interceptor', () => {
      const manager = new InterceptorManager<{ x: number }>();
      const visto = jest.fn();

      manager.forEach(visto);

      expect(visto).not.toHaveBeenCalled();
    });

    it('clear() lo devuelve al estado vacío', () => {
      const manager = new InterceptorManager<{ x: number }>();
      manager.use((v) => v);
      manager.clear();
      const visto = jest.fn();

      manager.forEach(visto);

      expect(visto).not.toHaveBeenCalled();
    });
  });
});
