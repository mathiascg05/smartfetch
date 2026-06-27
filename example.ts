/**
 * Ejemplo mínimo de uso de SmartFetch.
 *
 * Ejecuta una petición GET real contra una API pública y muestra la respuesta
 * normalizada. Pensado para una prueba de humo manual:
 *
 *   npx tsx example.ts
 */

import { SmartFetch, HttpError } from './src/index.js';

interface Post {
  id: number;
  title: string;
  body: string;
}

async function main(): Promise<void> {
  const client = new SmartFetch({ baseURL: 'https://jsonplaceholder.typicode.com' });

  // GET de un recurso con parámetros de consulta.
  const { data, status, url } = await client.get<Post[]>('/posts', { params: { userId: 1 } });
  console.log(`GET ${url} -> ${status} (${data.length} posts)`);
  console.log('Primer título:', data[0]?.title);

  // Manejo de un error HTTP (recurso inexistente).
  try {
    await client.get('/posts/999999');
  } catch (error) {
    if (error instanceof HttpError) {
      console.log(`Error HTTP esperado: ${error.status}`);
    }
  }
}

main().catch((error) => {
  console.error('Fallo inesperado:', error);
  process.exitCode = 1;
});
