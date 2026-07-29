import { jest } from '@jest/globals';
import { SmartFetch } from '../../src/client.js';
import { HttpError } from '../../src/errors.js';
import { FixedBackoff } from '../../src/retry/backoff.js';
import { defaultShouldRetry } from '../../src/retry/retry.js';
import { parseRetryAfter, retryAfterDelay } from '../../src/retry/retry-after.js';
import type { FetchAdapter } from '../../src/types.js';

/**
 * Soporte de la cabecera `Retry-After` (RFC 9110 §10.2.3).
 *
 * Cuando un servidor dice explícitamente cuánto esperar, esa indicación debe
 * ganar sobre el backoff configurado: el servidor sabe mejor que el cliente
 * cuándo estará listo. Solo aplica a 429 y 503, que son los códigos en los que la
 * cabecera tiene ese significado.
 */
describe('parseRetryAfter', () => {
  it('interpreta el formato en segundos', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('interpreta el formato de fecha HTTP', () => {
    const dentroDe30s = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfter(dentroDe30s);

    expect(ms).not.toBeNull();
    // Tolerancia amplia: la fecha HTTP tiene resolución de segundos.
    expect(ms as number).toBeGreaterThan(28_000);
    expect(ms as number).toBeLessThanOrEqual(30_000);
  });

  it('trata una fecha ya pasada como espera nula', () => {
    const hace1min = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(hace1min)).toBe(0);
  });

  it('devuelve null si no se puede interpretar', () => {
    expect(parseRetryAfter('pronto')).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('-5')).toBeNull();
  });
});

describe('Retry-After en el motor de reintentos', () => {
  /** Adaptador que falla `veces` con `status` y luego responde 200. */
  function flaky(status: number, headers: Record<string, string>, veces = 1) {
    let n = 0;
    return jest.fn<FetchAdapter>(async () => {
      n += 1;
      return n <= veces
        ? new Response('espera', { status, headers })
        : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  }

  it('un 503 con Retry-After espera lo que dice el servidor, no el backoff', async () => {
    const fetchMock = flaky(503, { 'Retry-After': '1' });
    const client = new SmartFetch(
      // El backoff configurado es enorme: si se usara, el test tardaría 30 s.
      { retries: 2, backoff: new FixedBackoff(30_000) },
      { fetch: fetchMock },
    );

    const inicio = Date.now();
    const res = await client.get('https://api.x.com/x');
    const transcurrido = Date.now() - inicio;

    expect(res.status).toBe(200);
    expect(transcurrido).toBeGreaterThanOrEqual(900);
    expect(transcurrido).toBeLessThan(3000);
  });

  it('un 429 se reintenta por defecto y respeta Retry-After', async () => {
    const fetchMock = flaky(429, { 'Retry-After': '0' });
    const client = new SmartFetch({ retries: 2 }, { fetch: fetchMock });

    const res = await client.get('https://api.x.com/x');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recorta Retry-After al tope configurado', async () => {
    const fetchMock = flaky(503, { 'Retry-After': '99999' });
    const client = new SmartFetch({ retries: 1, maxRetryAfterMs: 50 }, { fetch: fetchMock });

    const inicio = Date.now();
    await client.get('https://api.x.com/x');

    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('un Retry-After ilegible cae al backoff configurado', async () => {
    const fetchMock = flaky(503, { 'Retry-After': 'cuando pueda' });
    const backoff = new FixedBackoff(10);
    const delaySpy = jest.spyOn(backoff, 'delay');
    const client = new SmartFetch({ retries: 1, backoff }, { fetch: fetchMock });

    await client.get('https://api.x.com/x');

    expect(delaySpy).toHaveBeenCalledWith(1);
  });

  it('ignora Retry-After en códigos donde no significa espera (500)', async () => {
    const fetchMock = flaky(500, { 'Retry-After': '30' });
    const backoff = new FixedBackoff(10);
    const delaySpy = jest.spyOn(backoff, 'delay');
    const client = new SmartFetch({ retries: 1, backoff }, { fetch: fetchMock });

    const inicio = Date.now();
    await client.get('https://api.x.com/x');

    // Usó el backoff de 10 ms, no los 30 s de la cabecera.
    expect(delaySpy).toHaveBeenCalledWith(1);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('defaultShouldRetry incluye 429', () => {
    expect(defaultShouldRetry(new HttpError(429, 'Too Many Requests'))).toBe(true);
    expect(defaultShouldRetry(new HttpError(503, 'Service Unavailable'))).toBe(true);
    expect(defaultShouldRetry(new HttpError(404, 'Not Found'))).toBe(false);
  });
});

describe('retryAfterDelay', () => {
  it('solo aplica a los códigos donde la cabecera significa espera', () => {
    expect(retryAfterDelay(429, '5')).toBe(5000);
    expect(retryAfterDelay(503, '5')).toBe(5000);
    expect(retryAfterDelay(500, '5')).toBeNull();
    expect(retryAfterDelay(200, '5')).toBeNull();
  });

  it('usa el tope por defecto de un minuto cuando no se indica otro', () => {
    expect(retryAfterDelay(503, '3600')).toBe(60_000);
  });

  it('respeta un tope explícito', () => {
    expect(retryAfterDelay(503, '3600', 5000)).toBe(5000);
    expect(retryAfterDelay(503, '2', 5000)).toBe(2000);
  });

  it('devuelve null si la cabecera falta o es ilegible', () => {
    expect(retryAfterDelay(503, undefined)).toBeNull();
    expect(retryAfterDelay(503, 'mañana')).toBeNull();
  });
});
