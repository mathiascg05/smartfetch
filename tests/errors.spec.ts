import {
  SmartFetchError,
  TimeoutError,
  NetworkError,
  HttpError,
  ParseError,
} from '../src/errors.js';
import type { RequestConfig, SmartFetchResponse } from '../src/types.js';

/**
 * Pruebas unitarias del modelo de errores.
 *
 * Verifican la jerarquía de herencia (para que `instanceof` funcione tanto con
 * la clase base como con las derivadas), las categorías (`type`), los mensajes
 * generados y los metadatos que transporta cada error.
 */
describe('modelo de errores', () => {
  const config: RequestConfig = { url: '/usuarios', method: 'GET' };

  describe('SmartFetchError (clase base)', () => {
    it('es una instancia de Error y conserva nombre y mensaje', () => {
      const error = new SmartFetchError('algo salió mal');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SmartFetchError);
      expect(error.name).toBe('SmartFetchError');
      expect(error.message).toBe('algo salió mal');
    });

    it('usa la categoría "unknown" por defecto', () => {
      expect(new SmartFetchError('x').type).toBe('unknown');
    });

    it('almacena la configuración y la causa proporcionadas', () => {
      const cause = new Error('origen');
      const error = new SmartFetchError('falló', { type: 'request', config, cause });
      expect(error.type).toBe('request');
      expect(error.config).toBe(config);
      expect(error.cause).toBe(cause);
    });
  });

  describe('TimeoutError', () => {
    it('hereda de SmartFetchError y tiene la categoría "timeout"', () => {
      const error = new TimeoutError(5000, { config });
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SmartFetchError);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.type).toBe('timeout');
      expect(error.name).toBe('TimeoutError');
    });

    it('incluye el tiempo de espera en el campo y en el mensaje', () => {
      const error = new TimeoutError(5000);
      expect(error.timeout).toBe(5000);
      expect(error.message).toContain('5000');
    });

    it('isTimeout() devuelve true', () => {
      expect(new TimeoutError(1000).isTimeout()).toBe(true);
      expect(new TimeoutError(1000).isNetwork()).toBe(false);
    });
  });

  describe('NetworkError', () => {
    it('tiene la categoría "network" y un mensaje por defecto', () => {
      const error = new NetworkError();
      expect(error).toBeInstanceOf(SmartFetchError);
      expect(error).toBeInstanceOf(NetworkError);
      expect(error.type).toBe('network');
      expect(error.name).toBe('NetworkError');
      expect(error.message).toMatch(/network/i);
    });

    it('acepta un mensaje personalizado y la causa', () => {
      const cause = new TypeError('Failed to fetch');
      const error = new NetworkError('sin conexión', { config, cause });
      expect(error.message).toBe('sin conexión');
      expect(error.cause).toBe(cause);
      expect(error.isNetwork()).toBe(true);
    });
  });

  describe('HttpError', () => {
    it('tiene la categoría "http" y expone status/statusText', () => {
      const error = new HttpError(404, 'Not Found', { config });
      expect(error).toBeInstanceOf(SmartFetchError);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.type).toBe('http');
      expect(error.name).toBe('HttpError');
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.message).toContain('404');
      expect(error.isHttp()).toBe(true);
    });

    it('almacena la respuesta normalizada asociada', () => {
      const response = {
        data: { mensaje: 'no encontrado' },
        status: 404,
        statusText: 'Not Found',
        headers: {},
        ok: false,
        url: '/usuarios',
        config,
        raw: {} as Response,
      } as SmartFetchResponse;
      const error = new HttpError(404, 'Not Found', { config, response });
      expect(error.response).toBe(response);
    });
  });

  describe('ParseError', () => {
    it('hereda de SmartFetchError y tiene la categoría "parse"', () => {
      const error = new ParseError('no se pudo parsear', { config });
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SmartFetchError);
      expect(error).toBeInstanceOf(ParseError);
      expect(error.type).toBe('parse');
      expect(error.name).toBe('ParseError');
      expect(error.message).toMatch(/pars/i);
    });

    it('isParse() devuelve true y los demás guards false', () => {
      const error = new ParseError('x');
      expect(error.isParse()).toBe(true);
      expect(error.isHttp()).toBe(false);
      expect(error.isNetwork()).toBe(false);
      expect(error.isTimeout()).toBe(false);
    });

    it('almacena responseType, texto crudo, causa y configuración', () => {
      const cause = new SyntaxError('Unexpected token');
      const error = new ParseError('JSON inválido', {
        config,
        cause,
        responseType: 'json',
        text: '{roto',
      });
      expect(error.responseType).toBe('json');
      expect(error.text).toBe('{roto');
      expect(error.cause).toBe(cause);
      expect(error.config).toBe(config);
    });

    it('usa responseType "json" por defecto', () => {
      expect(new ParseError('x').responseType).toBe('json');
    });
  });
});
