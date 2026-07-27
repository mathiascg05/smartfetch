import { buildURL } from '../src/url.js';

/**
 * Pruebas unitarias de la construcción de URLs.
 *
 * Verifican la unión de `baseURL` con la ruta, el manejo de URLs absolutas y la
 * serialización de los parámetros de consulta (arreglos, omisión de
 * `null`/`undefined`, números y booleanos), preservando cualquier query previa.
 */
describe('buildURL', () => {
  it('une la baseURL con la ruta normalizando las barras', () => {
    expect(buildURL({ baseURL: 'https://api.x.com/v1', url: '/users' })).toBe(
      'https://api.x.com/v1/users',
    );
    expect(buildURL({ baseURL: 'https://api.x.com/v1/', url: 'users' })).toBe(
      'https://api.x.com/v1/users',
    );
  });

  it('usa la baseURL sola cuando no hay ruta', () => {
    expect(buildURL({ baseURL: 'https://api.x.com/v1' })).toBe('https://api.x.com/v1');
  });

  it('ignora la baseURL cuando la url es absoluta', () => {
    expect(buildURL({ baseURL: 'https://api.x.com', url: 'https://otra.com/data' })).toBe(
      'https://otra.com/data',
    );
  });

  it('serializa params simples (números, booleans y strings)', () => {
    const url = buildURL({
      baseURL: 'https://api.x.com',
      url: '/buscar',
      params: { q: 'hola', page: 2, activo: true },
    });
    expect(url).toBe('https://api.x.com/buscar?q=hola&page=2&activo=true');
  });

  it('repite la clave por cada elemento de un arreglo', () => {
    const url = buildURL({
      baseURL: 'https://api.x.com',
      url: '/items',
      params: { tags: ['a', 'b'] },
    });
    expect(url).toBe('https://api.x.com/items?tags=a&tags=b');
  });

  it('omite los valores null y undefined', () => {
    const url = buildURL({
      url: 'https://api.x.com/items',
      params: { a: 1, b: null, c: undefined, d: [1, null, 2] },
    });
    expect(url).toBe('https://api.x.com/items?a=1&d=1&d=2');
  });

  it('preserva la query ya presente en la url y le agrega params', () => {
    const url = buildURL({
      url: 'https://api.x.com/items?fixed=1',
      params: { page: 3 },
    });
    expect(url).toBe('https://api.x.com/items?fixed=1&page=3');
  });

  it('mantiene el fragmento (#) al final', () => {
    const url = buildURL({
      url: 'https://api.x.com/items#seccion',
      params: { page: 1 },
    });
    expect(url).toBe('https://api.x.com/items?page=1#seccion');
  });

  it('devuelve la ruta tal cual cuando no hay baseURL', () => {
    expect(buildURL({ url: '/usuarios' })).toBe('/usuarios');
    expect(buildURL({ url: 'usuarios' })).toBe('usuarios');
  });

  it('devuelve cadena vacía cuando no hay ni baseURL ni ruta', () => {
    expect(buildURL({})).toBe('');
  });

  it('no añade "?" cuando todos los parámetros se omiten', () => {
    const url = buildURL({
      url: 'https://api.x.com/items',
      params: { a: null, b: undefined },
    });
    expect(url).toBe('https://api.x.com/items');
  });
});
