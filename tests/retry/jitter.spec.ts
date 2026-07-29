import { ExponentialBackoff } from '../../src/retry/backoff.js';

/**
 * Jitter en el backoff exponencial.
 *
 * Sin jitter, N clientes que fallan a la vez reintentan exactamente a la vez, y
 * el pico de carga que tumbó al servidor se repite en cada ronda. Añadir azar a
 * la espera los desincroniza.
 *
 * Se usa *equal jitter*: el retardo cae en `[exp/2, exp]`. Frente a *full jitter*
 * (`[0, exp]`) conserva un suelo de espera, así que un servidor caído nunca
 * recibe un reintento casi inmediato.
 */
describe('ExponentialBackoff con jitter', () => {
  const MUESTRAS = 200;

  it('mantiene el retardo dentro de [exp/2, exp]', () => {
    const backoff = new ExponentialBackoff(100);
    // attempt 3 -> exponencial = 100 * 2^2 = 400
    const valores = Array.from({ length: MUESTRAS }, () => backoff.delay(3));

    for (const v of valores) {
      expect(v).toBeGreaterThanOrEqual(200);
      expect(v).toBeLessThanOrEqual(400);
    }
  });

  it('produce valores distintos entre invocaciones', () => {
    const backoff = new ExponentialBackoff(100);
    const distintos = new Set(Array.from({ length: MUESTRAS }, () => backoff.delay(3)));

    // Con 200 muestras sobre un rango de 200 ms, repetir siempre el mismo valor
    // sería una probabilidad despreciable: si pasa, no hay jitter.
    expect(distintos.size).toBeGreaterThan(1);
  });

  it('sigue respetando el máximo configurado', () => {
    const backoff = new ExponentialBackoff(100, 300);
    const valores = Array.from({ length: MUESTRAS }, () => backoff.delay(10));

    for (const v of valores) {
      expect(v).toBeLessThanOrEqual(300);
    }
  });

  it('está activado por defecto', () => {
    const backoff = new ExponentialBackoff(1000);
    const distintos = new Set(Array.from({ length: MUESTRAS }, () => backoff.delay(1)));

    expect(distintos.size).toBeGreaterThan(1);
  });

  describe('con { jitter: false }', () => {
    it('vuelve a ser determinista', () => {
      const backoff = new ExponentialBackoff(100, Infinity, { jitter: false });

      expect(backoff.delay(1)).toBe(100);
      expect(backoff.delay(2)).toBe(200);
      expect(backoff.delay(3)).toBe(400);
      expect(backoff.delay(4)).toBe(800);
    });

    it('acota al máximo igual que antes', () => {
      const backoff = new ExponentialBackoff(100, 1000, { jitter: false });

      expect(backoff.delay(4)).toBe(800);
      expect(backoff.delay(5)).toBe(1000);
      expect(backoff.delay(6)).toBe(1000);
    });
  });
});
