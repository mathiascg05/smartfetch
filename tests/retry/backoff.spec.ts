import { ExponentialBackoff, FixedBackoff } from '../../src/retry/backoff.js';

/**
 * Pruebas unitarias de las estrategias de backoff (patrón Strategy).
 *
 * El cálculo del retardo es puro (no crea temporizadores ni depende del reloj),
 * por lo que basta con verificar los valores que devuelve `delay()` para distintos
 * números de intento y configuraciones.
 */
describe('FixedBackoff', () => {
  it('devuelve siempre el mismo retardo, sea cual sea el intento', () => {
    const backoff = new FixedBackoff(200);
    expect(backoff.delay()).toBe(200);
  });

  it('por defecto no espera (0 ms)', () => {
    expect(new FixedBackoff().delay()).toBe(0);
  });

  it('trata los retardos negativos como 0', () => {
    expect(new FixedBackoff(-50).delay()).toBe(0);
  });
});

describe('ExponentialBackoff', () => {
  it('duplica el retardo en cada reintento a partir de la base', () => {
    const backoff = new ExponentialBackoff(100);
    expect(backoff.delay(1)).toBe(100);
    expect(backoff.delay(2)).toBe(200);
    expect(backoff.delay(3)).toBe(400);
    expect(backoff.delay(4)).toBe(800);
  });

  it('nunca supera el máximo configurado', () => {
    const backoff = new ExponentialBackoff(100, 1000);
    expect(backoff.delay(4)).toBe(800);
    expect(backoff.delay(5)).toBe(1000); // 1600 acotado a 1000
    expect(backoff.delay(6)).toBe(1000);
  });

  it('usa 100 ms de base por defecto', () => {
    expect(new ExponentialBackoff().delay(1)).toBe(100);
  });
});
