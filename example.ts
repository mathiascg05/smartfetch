/**
 * End-to-end SmartFetch example.
 *
 * Walks the whole public surface of the library against a real API
 * (jsonplaceholder) and, for the retry section, against a locally simulated
 * adapter. Meant as a manual smoke test:
 *
 *   npx tsx example.ts
 *
 * Sections:
 *   1. HTTP verbs: GET / POST / PUT / PATCH / DELETE.
 *   2. Request and response interceptors (aspect-oriented hooks).
 *   3. Configurable timeout (AbortController → TimeoutError).
 *   4. Retries + backoff with an injected FetchAdapter (Adapter pattern).
 */

import {
  SmartFetch,
  HttpError,
  TimeoutError,
  ExponentialBackoff,
  type FetchAdapter,
} from './src/index.js';

const API = 'https://jsonplaceholder.typicode.com';

/** Shape of a jsonplaceholder `post` resource. */
interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

/** Sections 1 + 2: HTTP verbs with interceptors attached. */
async function verbsAndInterceptors(): Promise<void> {
  console.log('\n=== 1. HTTP verbs + 2. Interceptors ===');

  const client = new SmartFetch({ baseURL: API });

  // REQUEST interceptor: adds a header and logs method + path.
  client.interceptors.request.use((config) => {
    config.headers = { ...config.headers, 'X-Demo': 'smartfetch' };
    console.log(`  -> ${config.method ?? 'GET'} ${config.url ?? ''}`);
    return config;
  });

  // RESPONSE interceptor: logs the status received.
  client.interceptors.response.use((response) => {
    console.log(`  <- ${response.status} ${response.statusText}`);
    return response;
  });

  // GET with query parameters.
  const list = await client.get<Post[]>('/posts', { params: { userId: 1 } });
  console.log(`GET /posts?userId=1 -> ${list.status} (${list.data.length} posts)`);

  // POST: create a resource (the body is the 2nd argument, axios-style).
  const created = await client.post<Post>('/posts', {
    title: 'Hello',
    body: 'Post body',
    userId: 1,
  });
  console.log(`POST /posts -> created with id ${created.data.id}`);

  // PUT: full replacement of resource 1.
  const replaced = await client.put<Post>('/posts/1', {
    id: 1,
    title: 'Replaced',
    body: 'New body',
    userId: 1,
  });
  console.log(`PUT /posts/1 -> title = "${replaced.data.title}"`);

  // PATCH: partial update of resource 1.
  const patched = await client.patch<Post>('/posts/1', { title: 'Patched' });
  console.log(`PATCH /posts/1 -> title = "${patched.data.title}"`);

  // DELETE: no positional body.
  const deleted = await client.delete('/posts/1');
  console.log(`DELETE /posts/1 -> ${deleted.status}`);

  // Handling an HTTP error (non-existent resource).
  try {
    await client.get('/posts/0');
  } catch (error) {
    if (error instanceof HttpError) {
      console.log(`Expected HTTP error: ${error.status}`);
    }
  }
}

/** Section 3: configurable timeout. */
async function timeout(): Promise<void> {
  console.log('\n=== 3. Timeout ===');

  // A 1 ms deadline is impossible to meet against the real network: it aborts.
  const client = new SmartFetch({ baseURL: API, timeout: 1 });
  try {
    await client.get('/posts');
    console.log('Unexpected: the request did not time out.');
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log('Expected TimeoutError (the request was aborted by the deadline).');
    } else {
      throw error;
    }
  }
}

/**
 * Section 4: retries + backoff with an injected FetchAdapter.
 *
 * The adapter simulates a flaky service: it answers 503 on the first two attempts
 * and 200 on the third. The default retry policy retries on 5xx, so the request
 * ends up succeeding without touching the external network.
 */
async function retries(): Promise<void> {
  console.log('\n=== 4. Retries + backoff (simulated adapter) ===');

  let attempt = 0;
  const adapter: FetchAdapter = async (input) => {
    attempt += 1;
    const failing = attempt < 3;
    console.log(`  attempt ${attempt} -> ${failing ? '503' : '200'} (${input})`);
    return failing
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

  const { data, status } = await client.get<{ ok: boolean }>('/flaky');
  console.log(`Succeeded after ${attempt} attempts -> ${status}, data = ${JSON.stringify(data)}`);
}

async function main(): Promise<void> {
  await verbsAndInterceptors();
  await timeout();
  await retries();
  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Unexpected failure:', error);
  process.exitCode = 1;
});
