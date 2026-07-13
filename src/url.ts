/**
 * Construcción de la URL final de una petición.
 *
 * Este módulo concentra la lógica pura de resolución de URLs: combina la
 * `baseURL` con la ruta del recurso y anexa los parámetros de consulta
 * (`params`). Al no depender de `fetch` ni de ningún estado, es fácil de probar
 * de forma aislada.
 *
 * @module url
 */

import type { QueryParamValue, RequestConfig } from './types.js';

/** Detecta si una URL es absoluta (incluye esquema http/https). */
const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * Combina la `baseURL` con la `url` del recurso.
 *
 * - Si `url` es absoluta (comienza por `http://` o `https://`), se usa tal cual
 *   y se ignora la `baseURL`.
 * - Si no hay `baseURL`, se devuelve `url` (o cadena vacía).
 * - En otro caso se unen normalizando la barra para no duplicarla ni perderla.
 */
function resolveURL(baseURL: string | undefined, url: string): string {
  if (ABSOLUTE_URL.test(url)) {
    return url;
  }
  if (!baseURL) {
    return url;
  }
  const base = baseURL.replace(/\/+$/, '');
  const path = url.replace(/^\/+/, '');
  if (!path) {
    return base;
  }
  return `${base}/${path}`;
}

/**
 * Anexa un único parámetro al {@link URLSearchParams}, omitiendo `null`/`undefined`
 * y convirtiendo números y booleanos a texto.
 */
function appendParam(search: URLSearchParams, key: string, value: QueryParamValue): void {
  if (value === null || value === undefined) {
    return;
  }
  search.append(key, String(value));
}

/**
 * Construye la URL final de una petición a partir de su configuración.
 *
 * Combina {@link RequestConfig.baseURL} y {@link RequestConfig.url}, y anexa los
 * {@link RequestConfig.params} preservando cualquier query ya presente en la URL.
 * Un valor de tipo arreglo genera una entrada repetida por cada elemento; los
 * valores `null`/`undefined` se omiten.
 *
 * @example
 * buildURL({ baseURL: 'https://api.x.com/v1', url: '/users', params: { page: 2, tags: ['a', 'b'] } });
 * // -> "https://api.x.com/v1/users?page=2&tags=a&tags=b"
 */
export function buildURL(config: RequestConfig): string {
  const resolved = resolveURL(config.baseURL, config.url ?? '');

  if (!config.params) {
    return resolved;
  }

  // Separa una posible query ya presente en la URL para fusionarla con `params`.
  const hashIndex = resolved.indexOf('#');
  const hash = hashIndex >= 0 ? resolved.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? resolved.slice(0, hashIndex) : resolved;

  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const existingQuery = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const search = new URLSearchParams(existingQuery);
  for (const [key, value] of Object.entries(config.params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendParam(search, key, item);
      }
    } else {
      appendParam(search, key, value);
    }
  }

  const query = search.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}
