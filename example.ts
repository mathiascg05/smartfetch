/**
 * End-to-end SmartFetch example.
 *
 * Walks the whole public surface against a real API (jsonplaceholder) and, where
 * a deterministic failure is needed, against a locally simulated adapter. Meant
 * as a manual smoke test:
 *
 *   npx tsx example.ts
 *
 * Sections:
 *   1. HTTP verbs, including HEAD and OPTIONS.
 *   2. Header shapes: record, pairs and a Headers instance.
 *   3. Request and response interceptors (aspect-oriented hooks).
 *   4. Per-attempt timeout and whole-operation totalTimeout.
 *   5. Retries: backoff with jitter, and Retry-After taking precedence.
 *   6. Response details: setCookie and the typed error model.
 *   7. RequestInit passthrough (credentials and friends).
 */

import {
  SmartFetch,
  SmartFetchBuilder,
  CancelledError,
  ExponentialBackoff,
  HttpError,
  TimeoutError,
  VERSION,
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

/** Section 1: every HTTP verb the client exposes. */
async function verbs(): Promise<void> {
  console.log('\n=== 1. HTTP verbs ===');

  const client = new SmartFetch({ baseURL: API });

  const list = await client.get<Post[]>('/posts', { params: { userId: 1 } });
  console.log(`GET    /posts?userId=1 -> ${list.status} (${list.data.length} posts)`);

  const created = await client.post<Post>('/posts', { title: 'Hello', body: 'Body', userId: 1 });
  console.log(`POST   /posts          -> created with id ${created.data.id}`);

  const replaced = await client.put<Post>('/posts/1', { id: 1, title: 'Replaced', userId: 1 });
  console.log(`PUT    /posts/1        -> title = "${replaced.data.title}"`);

  const patched = await client.patch<Post>('/posts/1', { title: 'Patched' });
  console.log(`PATCH  /posts/1        -> title = "${patched.data.title}"`);

  const deleted = await client.delete('/posts/1');
  console.log(`DELETE /posts/1        -> ${deleted.status}`);

  // HEAD carries headers but never a body: `data` is null for any responseType.
  const head = await client.head('/posts/1');
  console.log(`HEAD   /posts/1        -> ${head.status}, data = ${JSON.stringify(head.data)}`);

  const options = await client.options('/posts');
  console.log(`OPTIONS /posts         -> ${options.status}`);
}

/** Section 2: the three accepted header shapes. */
async function headerShapes(): Promise<void> {
  console.log('\n=== 2. Header shapes ===');

  // A local adapter is used here so the headers that go out can be inspected.
  let sent: RequestInit | undefined;
  const capture: FetchAdapter = (_url, init) => {
    sent = init;
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  };

  const show = (label: string) => {
    const names: string[] = [];
    new Headers(sent?.headers).forEach((value, name) => names.push(`${name}: ${value}`));
    console.log(`${label.padEnd(22)} -> ${names.join(' | ')}`);
  };

  const client = new SmartFetch({ baseURL: API }, { fetch: capture });

  await client.get('/x', { headers: { 'X-Shape': 'record' } });
  show('record');

  await client.get('/x', { headers: [['X-Shape', 'pairs']] });
  show('array of pairs');

  await client.get('/x', { headers: new Headers({ 'X-Shape': 'headers' }) });
  show('Headers instance');

  // The same header twice. `fetch` joins them into one comma-separated field
  // line before sending, which is the RFC-equivalent form.
  await client.get('/x', {
    headers: [
      ['Accept', 'application/json'],
      ['Accept', 'text/plain'],
    ],
  });
  show('multi-value');

  // A client default is replaced per name, not appended to.
  const withDefaults = new SmartFetch(
    { baseURL: API, headers: { Accept: 'application/json' } },
    { fetch: capture },
  );
  await withDefaults.get('/x', { headers: { Accept: 'text/csv' } });
  show('request replaces');
}

/** Section 3: interceptors. */
async function interceptors(): Promise<void> {
  console.log('\n=== 3. Interceptors ===');

  const client = new SmartFetch({ baseURL: API });

  client.interceptors.request.use((config) => {
    config.headers = { ...(config.headers as Record<string, string>), 'X-Demo': 'smartfetch' };
    console.log(`  -> ${config.method ?? 'GET'} ${config.url ?? ''}`);
    return config;
  });

  client.interceptors.response.use((response) => {
    console.log(`  <- ${response.status} ${response.statusText}`);
    return response;
  });

  await client.get<Post>('/posts/1');
}

/** Section 4: per-attempt timeout and whole-operation budget. */
async function timeouts(): Promise<void> {
  console.log('\n=== 4. Timeout and totalTimeout ===');

  // A 1 ms deadline cannot be met against the real network: it aborts.
  try {
    await new SmartFetch({ baseURL: API, timeout: 1 }).get('/posts');
    console.log('Unexpected: the request did not time out.');
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log(`Per-attempt timeout  -> TimeoutError after ${error.timeout} ms`);
    } else {
      throw error;
    }
  }

  // `timeout` bounds one attempt; `totalTimeout` bounds the whole operation,
  // backoff waits included. Here five attempts of 500 ms would take 2.5 s.
  const alwaysDown: FetchAdapter = () =>
    Promise.resolve(new Response('down', { status: 503, statusText: 'Service Unavailable' }));

  const started = Date.now();
  try {
    await new SmartFetch(
      { retries: 5, backoff: new ExponentialBackoff(500), totalTimeout: 300 },
      { fetch: alwaysDown },
    ).get('/flaky');
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log(`Whole-operation      -> TimeoutError after ${Date.now() - started} ms`);
    }
  }

  // Cancelling is not a timeout, and is never retried.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  try {
    await new SmartFetch({ baseURL: API, signal: controller.signal, timeout: 5000 }).get('/posts');
  } catch (error) {
    if (error instanceof CancelledError) {
      console.log('Cancellation         -> CancelledError (distinct from a timeout)');
    }
  }
}

/** Section 5: retries, jitter and Retry-After. */
async function retries(): Promise<void> {
  console.log('\n=== 5. Retries ===');

  // Flaky service: 503 twice, then 200. Default policy retries 5xx.
  let attempt = 0;
  const flaky: FetchAdapter = (input) => {
    attempt += 1;
    const failing = attempt < 3;
    console.log(`  attempt ${attempt} -> ${failing ? '503' : '200'} (${input})`);
    return Promise.resolve(
      failing
        ? new Response('down', { status: 503, statusText: 'Service Unavailable' })
        : new Response('{"ok":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  };

  const client = new SmartFetch(
    { baseURL: API, retries: 3, backoff: new ExponentialBackoff(50) },
    { fetch: flaky },
  );
  const { status } = await client.get<{ ok: boolean }>('/flaky');
  console.log(`Recovered after ${attempt} attempts -> ${status}`);

  // Jitter is on by default, so the wait is randomised within [exp/2, exp].
  const backoff = new ExponentialBackoff(100);
  const samples = [backoff.delay(3), backoff.delay(3), backoff.delay(3)];
  console.log(`Jitter (attempt 3)   -> ${samples.map((n) => Math.round(n)).join(', ')} ms`);

  // Retry-After wins over the configured backoff: the server knows better.
  let rateLimited = 0;
  const limited: FetchAdapter = () => {
    rateLimited += 1;
    return Promise.resolve(
      rateLimited === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } })
        : new Response('{"ok":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  };

  const waited = Date.now();
  await new SmartFetch(
    // The configured backoff is 30 s; Retry-After says 1 s, and that wins.
    { retries: 2, backoff: new ExponentialBackoff(30_000) },
    { fetch: limited },
  ).get('/limited');
  console.log(`Retry-After honoured -> waited ~${Math.round((Date.now() - waited) / 100) / 10} s`);
}

/** Section 6: response details and the typed error model. */
async function responses(): Promise<void> {
  console.log('\n=== 6. Response and errors ===');

  // Repeated Set-Cookie headers are preserved in `setCookie`; a flat record
  // could only have kept the last one.
  const withCookies: FetchAdapter = () =>
    Promise.resolve(
      new Response('{}', {
        status: 200,
        headers: [
          ['Content-Type', 'application/json'],
          ['Set-Cookie', 'session=abc; Path=/'],
          ['Set-Cookie', 'theme=dark; Path=/'],
        ],
      }),
    );

  const res = await new SmartFetch({}, { fetch: withCookies }).get('https://api.example.com/login');
  console.log(`setCookie            -> ${JSON.stringify(res.setCookie)}`);
  console.log(
    `headers['set-cookie'] -> ${String(res.headers['set-cookie'])} (deliberately absent)`,
  );

  // Typed errors: narrow with instanceof, `type` or the isX() guards.
  try {
    await new SmartFetch({ baseURL: API }).get('/posts/0');
  } catch (error) {
    if (error instanceof HttpError) {
      console.log(`HttpError            -> ${error.status}, isHttp() = ${error.isHttp()}`);
    }
  }
}

/** Section 7: native RequestInit options are forwarded untouched. */
async function passthrough(): Promise<void> {
  console.log('\n=== 7. RequestInit passthrough ===');

  let sent: RequestInit | undefined;
  const capture: FetchAdapter = (_url, init) => {
    sent = init;
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  };

  // `credentials: 'include'` is what enables cookie auth in the browser.
  const api = new SmartFetchBuilder()
    .baseURL(API)
    .header('Authorization', 'Bearer token')
    .timeout(5000)
    .adapter(capture)
    .build();

  await api.get('/posts/1', { credentials: 'include', redirect: 'manual', cache: 'no-store' });
  console.log(
    `Forwarded            -> credentials=${String(sent?.credentials)}, ` +
      `redirect=${String(sent?.redirect)}, cache=${String(sent?.cache)}`,
  );

  // Options nobody set are simply absent, so `fetch` keeps its own defaults.
  await api.get('/posts/1');
  console.log(`Unset options        -> mode=${String(sent?.mode)} (absent, not defaulted)`);
}

async function main(): Promise<void> {
  console.log(`SmartFetch v${VERSION}`);
  await verbs();
  await headerShapes();
  await interceptors();
  await timeouts();
  await retries();
  await responses();
  await passthrough();
  console.log('\nDone.');
}

main().catch((error: unknown) => {
  console.error('Unexpected failure:', error);
  process.exitCode = 1;
});
