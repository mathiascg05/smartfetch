import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Endpoints de prueba servidos por el propio servidor de Vitest.
 *
 * La suite de navegador golpea HTTP real a través del `fetch` real del navegador.
 * Inyectar un adaptador simulado habría sido más simple, pero solo demostraría
 * que el módulo carga en Chromium — no que la librería se comporte bien sobre la
 * pila de red del navegador, que es justo la afirmación que hay que respaldar.
 *
 * Al servirse desde el mismo origen que la página de pruebas no hay CORS de por
 * medio, que sería ruido ajeno a lo que se quiere verificar.
 */
function testEndpoints(): Plugin {
  /** Intentos vistos por id, para simular un servicio inestable de forma determinista. */
  const intentos = new Map<string, number>();

  return {
    name: 'smartfetch-test-endpoints',
    configureServer(server) {
      server.middlewares.use('/__test', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const ruta = url.pathname;

        const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
          res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
          res.end(JSON.stringify(body));
        };

        // Devuelve lo recibido: sirve para verbos, cabeceras y query reales.
        if (ruta === '/echo') {
          let cuerpo = '';
          req.on('data', (c) => (cuerpo += String(c)));
          req.on('end', () =>
            json({
              method: req.method,
              headers: req.headers,
              query: Object.fromEntries(url.searchParams.entries()),
              body: cuerpo,
            }),
          );
          return;
        }

        // Falla con 503 las primeras `fail` veces para cada `id`, luego responde 200.
        if (ruta === '/flaky') {
          const id = url.searchParams.get('id') ?? 'sin-id';
          const fallos = Number(url.searchParams.get('fail') ?? '1');
          const visto = (intentos.get(id) ?? 0) + 1;
          intentos.set(id, visto);
          if (visto <= fallos) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end('{"error":"unavailable"}');
            return;
          }
          json({ recovered: true, attempts: visto });
          return;
        }

        // 429 con Retry-After, para el camino de la cabecera.
        if (ruta === '/rate-limited') {
          const id = url.searchParams.get('id') ?? 'sin-id';
          const visto = (intentos.get(id) ?? 0) + 1;
          intentos.set(id, visto);
          if (visto <= 1) {
            res.writeHead(429, { 'Retry-After': '0' });
            res.end('slow down');
            return;
          }
          json({ ok: true });
          return;
        }

        // No responde nunca: timeouts y cancelaciones.
        if (ruta === '/hang') {
          return;
        }

        if (ruta === '/204') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (ruta === '/status') {
          json({ pedido: true }, Number(url.searchParams.get('code') ?? '200'));
          return;
        }

        json({ error: 'not found' }, 404);
      });
    },
  };
}

export default defineConfig({
  plugins: [testEndpoints()],
  test: {
    include: ['tests/browser/**/*.spec.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
});
