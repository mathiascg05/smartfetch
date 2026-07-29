import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Servidor HTTP de apoyo para las pruebas de integración.
 *
 * Las pruebas unitarias inyectan un `FetchAdapter` que devuelve objetos
 * `Response` fabricados a mano, así que nunca ejercitan lo que `fetch` hace de
 * verdad: concatenar cabeceras repetidas, consumir cuerpos, respetar señales ya
 * abortadas o cortar una conexión a mitad. Ese punto ciego dejó pasar ocho bugs
 * de comportamiento con un 100% de cobertura, y es lo que estas suites cubren.
 *
 * Cada suite levanta el servidor en un puerto efímero y lo cierra al terminar.
 */

/** Estado mutable que las pruebas ajustan por caso. */
export interface ServerState {
  /** Cuántas veces se ha pedido cada ruta, para verificar reintentos. */
  hits: Record<string, number>;
  /** Fuerza a que `/flaky` falle este número de veces antes de responder 200. */
  flakyFailures: number;
  /** Valor de `Retry-After` que emite `/rate-limited` y `/unavailable`. */
  retryAfter: string;
}

export interface TestServer {
  /** URL base, con puerto ya resuelto. */
  base: string;
  state: ServerState;
  close: () => Promise<void>;
}

/**
 * Levanta el servidor de pruebas en un puerto efímero.
 *
 * Las rutas cubren, cada una, un comportamiento que solo se manifiesta contra la
 * pila real de HTTP.
 */
export async function startServer(): Promise<TestServer> {
  const state: ServerState = { hits: {}, flakyFailures: 1, retryAfter: '0' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    state.hits[path] = (state.hits[path] ?? 0) + 1;

    const json = (body: unknown, status = 200, headers: http.OutgoingHttpHeaders = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    switch (path) {
      // Devuelve lo que recibió, para verificar cabeceras y query reales.
      case '/echo':
        json({
          method: req.method,
          headers: req.headers,
          query: Object.fromEntries(url.searchParams.entries()),
          queryRaw: url.search,
        });
        return;

      // Dos Set-Cookie: un Record plano solo conservaría una.
      case '/cookies':
        res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
        json({});
        return;

      // Estados sin cuerpo por especificación.
      case '/204':
        res.writeHead(204);
        res.end();
        return;
      case '/205':
        res.writeHead(205);
        res.end();
        return;
      case '/304':
        res.writeHead(304);
        res.end();
        return;

      // Falla con 503 las primeras `flakyFailures` veces y luego responde 200.
      case '/flaky':
        if (state.hits[path] <= state.flakyFailures) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end('{"error":"unavailable"}');
          return;
        }
        json({ recovered: true, attempts: state.hits[path] });
        return;

      // 429 y 503 con Retry-After, para el camino de la cabecera.
      case '/rate-limited':
        if (state.hits[path] <= 1) {
          res.writeHead(429, { 'Retry-After': state.retryAfter });
          res.end('slow down');
          return;
        }
        json({ ok: true });
        return;
      case '/unavailable':
        if (state.hits[path] <= 1) {
          res.writeHead(503, { 'Retry-After': state.retryAfter });
          res.end('come back later');
          return;
        }
        json({ ok: true });
        return;

      // No responde nunca: para timeouts y cancelaciones.
      case '/hang':
        return;

      // Envía cabeceras y parte del cuerpo, luego mata el socket: simula una
      // conexión que se corta a mitad de la respuesta.
      case '/truncated':
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
        res.write('{"incompl');
        setTimeout(() => req.socket.destroy(), 10);
        return;

      // Responde 200 con un cuerpo que no es JSON válido.
      case '/malformed':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{no es json');
        return;

      default:
        json({ error: 'not found' }, 404);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
