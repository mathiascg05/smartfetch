/**
 * Ejemplo end-to-end de SmartFetch.
 *
 * Recorre toda la superficie pública de la librería contra una API real
 * (jsonplaceholder) y, para los reintentos, contra un adaptador simulado en
 * local. Pensado como prueba de humo manual:
 *
 *   npx tsx example.ts
 *
 * Secciones:
 *   1. Verbos HTTP: GET / POST / PUT / PATCH / DELETE.
 *   2. Interceptores de petición y respuesta (Programación Orientada a Aspectos).
 *   3. Timeout configurable (AbortController → TimeoutError).
 *   4. Reintentos + backoff con un FetchAdapter inyectado (patrón Adapter).
 */

import {
  SmartFetch,
  HttpError,
  TimeoutError,
  ExponentialBackoff,
  type FetchAdapter,
} from './src/index.js';

const API = 'https://jsonplaceholder.typicode.com';

/** Forma de un recurso `post` de jsonplaceholder. */
interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

/** Sección 1 + 2: verbos HTTP con interceptores enganchados. */
async function verbosEInterceptores(): Promise<void> {
  console.log('\n=== 1. Verbos HTTP + 2. Interceptores ===');

  const client = new SmartFetch({ baseURL: API });

  // Interceptor de PETICIÓN: añade una cabecera y registra método + ruta.
  client.interceptors.request.use((config) => {
    config.headers = { ...config.headers, 'X-Demo': 'smartfetch' };
    console.log(`  -> ${config.method ?? 'GET'} ${config.url ?? ''}`);
    return config;
  });

  // Interceptor de RESPUESTA: registra el estado recibido.
  client.interceptors.response.use((response) => {
    console.log(`  <- ${response.status} ${response.statusText}`);
    return response;
  });

  // GET con parámetros de consulta.
  const list = await client.get<Post[]>('/posts', { params: { userId: 1 } });
  console.log(`GET /posts?userId=1 -> ${list.status} (${list.data.length} posts)`);

  // POST: crear un recurso (el cuerpo va como 2º argumento, estilo axios).
  const created = await client.post<Post>('/posts', {
    title: 'Hola',
    body: 'Cuerpo del post',
    userId: 1,
  });
  console.log(`POST /posts -> creado con id ${created.data.id}`);

  // PUT: reemplazo completo del recurso 1.
  const replaced = await client.put<Post>('/posts/1', {
    id: 1,
    title: 'Reemplazado',
    body: 'Nuevo cuerpo',
    userId: 1,
  });
  console.log(`PUT /posts/1 -> title = "${replaced.data.title}"`);

  // PATCH: actualización parcial del recurso 1.
  const patched = await client.patch<Post>('/posts/1', { title: 'Parcheado' });
  console.log(`PATCH /posts/1 -> title = "${patched.data.title}"`);

  // DELETE: sin cuerpo posicional.
  const deleted = await client.delete('/posts/1');
  console.log(`DELETE /posts/1 -> ${deleted.status}`);

  // Manejo de un error HTTP (recurso inexistente).
  try {
    await client.get('/posts/0');
  } catch (error) {
    if (error instanceof HttpError) {
      console.log(`Error HTTP esperado: ${error.status}`);
    }
  }
}

/** Sección 3: timeout configurable. */
async function timeout(): Promise<void> {
  console.log('\n=== 3. Timeout ===');

  // Un plazo de 1 ms es imposible de cumplir contra la red real: aborta.
  const client = new SmartFetch({ baseURL: API, timeout: 1 });
  try {
    await client.get('/posts');
    console.log('Inesperado: la petición no expiró.');
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log('TimeoutError esperado (la petición se abortó por el plazo).');
    } else {
      throw error;
    }
  }
}

/**
 * Sección 4: reintentos + backoff con un FetchAdapter inyectado.
 *
 * El adaptador simula un servicio inestable: responde 503 en los dos primeros
 * intentos y 200 en el tercero. La política de reintentos por defecto reintenta
 * ante 5xx, así que la petición acaba teniendo éxito sin tocar la red externa.
 */
async function reintentos(): Promise<void> {
  console.log('\n=== 4. Reintentos + backoff (adaptador simulado) ===');

  let intento = 0;
  const adapter: FetchAdapter = async (input) => {
    intento += 1;
    const fallando = intento < 3;
    console.log(`  intento ${intento} -> ${fallando ? '503' : '200'} (${input})`);
    return fallando
      ? new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' })
      : new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
  };

  const client = new SmartFetch(
    { baseURL: API, retries: 3, backoff: new ExponentialBackoff(50) },
    { fetch: adapter },
  );

  const { data, status } = await client.get<{ ok: boolean }>('/inestable');
  console.log(`Éxito tras ${intento} intentos -> ${status}, data = ${JSON.stringify(data)}`);
}

async function main(): Promise<void> {
  await verbosEInterceptores();
  await timeout();
  await reintentos();
  console.log('\nListo.');
}

main().catch((error) => {
  console.error('Fallo inesperado:', error);
  process.exitCode = 1;
});
