import { jest } from '@jest/globals';
import { withTimeout } from '../src/timeout.js';
import { TimeoutError } from '../src/errors.js';

/**
 * Pruebas unitarias de {@link withTimeout}.
 *
 * Se usan operaciones simuladas (resueltas o "colgadas") en lugar de red real:
 * una operación colgada solo se resuelve/rechaza cuando su señal se aborta, lo
 * que permite verificar el disparo del timeout, la no cancelación de peticiones
 * rápidas, la limpieza de temporizadores y la convivencia con una señal externa.
 */
describe('withTimeout', () => {
  /** Operación que nunca resuelve por sí sola; rechaza con AbortError al abortarse la señal. */
  function hangingOperation(): (signal: AbortSignal | undefined) => Promise<never> {
    return (signal) =>
      new Promise((_resolve, reject) => {
        const abortar = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) {
          abortar();
          return;
        }
        signal?.addEventListener('abort', abortar);
      });
  }

  it('sin timeout ejecuta la operación con la señal externa tal cual, sin crear timers', async () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const externalSignal = new AbortController().signal;
    let recibida: AbortSignal | undefined;

    const valor = await withTimeout(0, externalSignal, async (signal) => {
      recibida = signal;
      return 'ok';
    });

    expect(valor).toBe('ok');
    expect(recibida).toBe(externalSignal);
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('lanza TimeoutError cuando se agota el plazo', async () => {
    expect.assertions(3);
    try {
      await withTimeout(10, undefined, hangingOperation());
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeout).toBe(10);
      expect((error as TimeoutError).isTimeout()).toBe(true);
    }
  });

  it('no cancela una operación que resuelve antes del plazo', async () => {
    const valor = await withTimeout(1000, undefined, async () => 'rápido');
    expect(valor).toBe('rápido');
  });

  it('limpia el temporizador tras resolver la operación', async () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    await withTimeout(1000, undefined, async () => 'listo');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('limpia el temporizador aunque la operación rechace', async () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    await expect(
      withTimeout(1000, undefined, async () => {
        throw new Error('fallo interno');
      }),
    ).rejects.toThrow('fallo interno');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('propaga el AbortError de la señal externa sin convertirlo en TimeoutError', async () => {
    const controller = new AbortController();
    const promesa = withTimeout(1000, controller.signal, hangingOperation());
    controller.abort();

    await expect(promesa).rejects.not.toBeInstanceOf(TimeoutError);
  });

  it('aborta de inmediato si la señal externa ya estaba abortada', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      withTimeout(1000, controller.signal, hangingOperation()),
    ).rejects.not.toBeInstanceOf(TimeoutError);
  });
});
