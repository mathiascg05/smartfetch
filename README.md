# SmartFetch

[![CI](https://github.com/mathiascg05/smartfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/mathiascg05/smartfetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@mathiascg05/smartfetch.svg)](https://www.npmjs.com/package/@mathiascg05/smartfetch)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)](#testing)
[![bundle size](https://img.shields.io/badge/ESM%20bundle-3.6%20kB%20gzip-brightgreen.svg)](#testing)
[![mutation score](https://img.shields.io/badge/mutation%20score-86%25-green.svg)](#testing)
[![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](#)
[![license](https://img.shields.io/npm/l/@mathiascg05/smartfetch.svg)](./LICENSE)

A resilient wrapper around the native **`fetch`** API, written in **TypeScript** with **zero
runtime dependencies**. It offers a clean, high-level interface (axios-style) built on `fetch`
underneath: configurable timeouts, automatic retries with pluggable wait strategies, the full set
of HTTP verbs, interceptors and a typed error model.

> **TypeScript** · **Zero runtime dependencies** · **Node ≥ 18** · **ESM + CJS** · async/await and Promises

🇪🇸 [Léeme en español](./README.es.md)

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Creating clients](#creating-clients)
- [Timeout](#timeout)
- [Retries and backoff](#retries-and-backoff)
- [Parsing and `validateStatus`](#parsing-and-validatestatus)
- [Interceptors](#interceptors)
- [Configuration reference](#configuration-reference)
- [Response and errors](#response-and-errors)
- [Design patterns](#design-patterns)
- [Limitations and non-goals](#limitations-and-non-goals)
- [Testing](#testing)
- [Origin](#origin)
- [License](#license)

## Installation

SmartFetch uses the native `fetch`, so it needs **Node.js ≥ 18** (or any modern runtime with a
global `fetch`).

```bash
npm install @mathiascg05/smartfetch
```

It can also be installed straight from the repository:

```bash
npm install github:mathiascg05/smartfetch
```

The package ships **ESM** (`dist/index.js`), **CommonJS** (`dist/index.cjs`) and type declarations
(`dist/index.d.ts`), so it works with both `import` and `require`:

```ts
import smartfetch, { SmartFetch } from '@mathiascg05/smartfetch'; // ESM / TypeScript
```

```js
const { SmartFetch } = require('@mathiascg05/smartfetch'); // CommonJS
```

## Quick start

```ts
import { SmartFetch, HttpError, ParseError } from '@mathiascg05/smartfetch';

const client = new SmartFetch({ baseURL: 'https://api.example.com' });

// GET with query parameters and a typed response body.
const { data, status } = await client.get<User[]>('/users', { params: { page: 1 } });
console.log(status, data);

// POST/PUT/PATCH: the body is the 2nd argument (axios-style). Plain objects are
// serialized to JSON and get a Content-Type: application/json header automatically.
const created = await client.post<User>('/users', { name: 'Ada' });
await client.put<User>('/users/1', { name: 'Ada Lovelace' });
await client.patch<User>('/users/1', { active: false });

// DELETE takes no positional body.
await client.delete('/users/1');

// Typed failures: HTTP (4xx/5xx), network and body-parsing errors.
try {
  await client.get('/users/999');
} catch (error) {
  if (error instanceof HttpError) {
    console.error('HTTP', error.status, error.response?.data);
  } else if (error instanceof ParseError) {
    // The body of a successful response was not valid JSON.
    console.error('Parse', error.responseType, error.text);
  }
}
```

Every method returns a **`Promise`**, so `async/await` and `.then()`/`.catch()` chains work equally
well:

```ts
client
  .get<User[]>('/users')
  .then((res) => console.log(res.data))
  .catch((err) => console.error(err));
```

The response is a `SmartFetchResponse<T>` carrying `data`, `status`, `statusText`, `headers`, `ok`,
`url`, `config` and `raw` (the native `Response`). The body is parsed as JSON by default; that can
be changed with `responseType: 'text' | 'blob' | 'arrayBuffer' | 'formData'`. Body-less statuses
(204/205/304) yield `data === null` in every format. The underlying `fetch` is injectable
(`new SmartFetch(defaults, { fetch })`) following the Adapter pattern.

## Creating clients

Besides `new SmartFetch(...)`, the library offers two ways to create clients plus a ready-to-use
instance:

```ts
import smartfetch, {
  createClient,
  SmartFetchBuilder,
  ExponentialBackoff,
} from '@mathiascg05/smartfetch';

// 1) Factory: creates a client without `new`.
const api = createClient({ baseURL: 'https://api.example.com', timeout: 5000 });

// 2) Builder: composes the configuration step by step (fluent API).
const api2 = new SmartFetchBuilder()
  .baseURL('https://api.example.com')
  .header('Authorization', 'Bearer token')
  .timeout(5000)
  .retries(2)
  .backoff(new ExponentialBackoff())
  .build();

// 3) Singleton: the default instance (default export) for quick one-off calls.
const { data } = await smartfetch.get('https://api.example.com/status');
```

`createClient` (**Factory** pattern) and `SmartFetchBuilder` (**Builder** pattern) both produce a
`SmartFetch` instance; the default export `smartfetch` is an unconfigured default client
(**Singleton** pattern), handy for one-off requests with absolute URLs.

## Timeout

`timeout` (in milliseconds) cancels the request and throws a `TimeoutError` if the server does not
answer in time. Cancellation is implemented internally with `AbortController`. A value of `0`, or
omitting it, means **no deadline**.

```ts
import { TimeoutError } from '@mathiascg05/smartfetch';

try {
  await client.get('/slow', { timeout: 2000 }); // aborts after 2 s
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error(`The request exceeded ${error.timeout} ms`);
  }
}
```

If you pass your own `signal` (`AbortSignal`), it is combined with the internal timeout: whichever
fires first aborts the request. An external abort propagates as-is (it is not translated into a
`TimeoutError`).

## Retries and backoff

SmartFetch automatically retries requests that fail **transiently**. The default is `retries: 0`
(a single attempt). The default policy retries **only** on:

- network errors (`NetworkError`), and
- HTTP **5xx** responses (`HttpError` with `status` 500–599).

It does **not** retry timeouts, 4xx errors or parsing errors (`ParseError`).

```ts
import { SmartFetch, FixedBackoff, ExponentialBackoff } from '@mathiascg05/smartfetch';

// 2 retries (3 attempts total) with exponential waits: 100 ms, 200 ms, 400 ms...
const client = new SmartFetch({
  baseURL: 'https://api.example.com',
  retries: 2,
  backoff: new ExponentialBackoff(100), // baseMs = 100, maxMs = Infinity
});

// Fixed wait between retries (interchangeable Strategy pattern).
const other = new SmartFetch({ retries: 3, backoff: new FixedBackoff(500) });
```

The wait strategy is an interchangeable **Strategy** (`BackoffStrategy`):
`FixedBackoff(delayMs = 0)` and `ExponentialBackoff(baseMs = 100, maxMs = Infinity, options)`. The
backoff wait is cancellable through the external `signal`.

`ExponentialBackoff` applies **jitter by default**, so clients that failed together do not retry
together and repeat the load spike. It uses _equal jitter_: the delay lands in
`[exponential / 2, exponential]`, which keeps a floor unlike full jitter. Disable it with
`new ExponentialBackoff(100, Infinity, { jitter: false })` when a deterministic delay is needed.

For custom policies, `retryOn` replaces the default decision:

### `Retry-After`

On a **429** or **503**, a server may state how long to wait through the `Retry-After` header —
either as seconds (`Retry-After: 120`) or as an HTTP date. SmartFetch honours it and gives it
**precedence over the configured backoff**: the server knows better than the client when it will be
ready.

The delay is capped by `maxRetryAfterMs` (default one minute) so a server asking for an hour cannot
hang the request that long. An unparseable value falls back to the configured backoff, and the
header is ignored on statuses where it does not mean "wait".

`429` is part of the default retry policy for the same reason: it is a rate limit that clears on its
own, not a client mistake.

```ts
// Also retry on 429 (Too Many Requests), up to 4 attempts.
await client.get('/resource', {
  retries: 3,
  retryOn: (error, attempt) =>
    error instanceof HttpError && (error.status === 429 || error.status >= 500),
});
```

## Parsing and `validateStatus`

An unreadable body in the requested format (malformed JSON, for instance) on an **accepted**
response throws a `ParseError` (carrying `responseType`, the raw `text` and the original `cause`).
On an **error** response, the `HttpError` takes precedence instead and the raw body stays available
in `error.response?.data`, so a parsing problem never hides the HTTP failure.

By default only the **2xx** range counts as successful; this can be redefined per request with
`validateStatus`, which decides which codes are accepted (resolve) and which are rejected with an
`HttpError`:

```ts
// Accept 304 (Not Modified) as a success too.
await client.get('/resource', {
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
});
```

## Interceptors

Interceptors let you handle cross-cutting concerns — logging, authentication, data transformation,
error recovery — centrally, without touching the client core.

```ts
// Request interceptor: runs before sending. Ideal for auth or logging.
const authId = client.interceptors.request.use((config) => {
  config.headers = { ...config.headers, Authorization: 'Bearer ' + token };
  return config;
});

// Response interceptor: transforms the response once received.
client.interceptors.response.use((response) => {
  console.log(`${response.config.method} ${response.url} -> ${response.status}`);
  return response;
});

// The 2nd argument handles errors and can recover by returning a fallback response.
client.interceptors.response.use(undefined, (error) => {
  if (error instanceof HttpError && error.status >= 500) {
    return { ...error.response, data: { offline: true } };
  }
  throw error; // rethrown to propagate when recovery is not possible
});

// use() returns an id for removing the interceptor later.
client.interceptors.request.eject(authId);
```

Request interceptors run in reverse registration order (LIFO) and response interceptors in
registration order (FIFO), matching `axios`.

## Configuration reference

`RequestConfig` (every field is optional). It can be supplied as the client's default configuration
and/or per request; request values are merged over the client ones.

| Option            | Type                          | Description                                                                                                     |
| ----------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `baseURL`         | `string`                      | Base URL that relative paths resolve against.                                                                   |
| `url`             | `string`                      | Request path or URL (normally the 1st argument of each method).                                                 |
| `method`          | `HttpMethod`                  | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` \| `HEAD` \| `OPTIONS`.                                         |
| `headers`         | `Record<string, string>`      | HTTP headers. Merged case-insensitively with the client defaults (see below).                                   |
| `params`          | `QueryParams`                 | Query parameters (serialized to a query string; arrays supported). Merged with the client defaults (see below). |
| `body`            | `unknown`                     | Request body; plain objects are serialized to JSON with their `Content-Type`.                                   |
| `timeout`         | `number`                      | Milliseconds before aborting (`0`/omitted = no deadline). Bounds a single attempt.                              |
| `totalTimeout`    | `number`                      | Milliseconds for the whole operation, backoff waits included (`0`/omitted = no global deadline).                |
| `retries`         | `number`                      | Retries on transient failures (default `0` = one attempt). Not compatible with a stream body — see below.       |
| `backoff`         | `BackoffStrategy`             | Wait strategy between retries (Strategy).                                                                       |
| `retryOn`         | `RetryPredicate`              | Predicate `(error, attempt) => boolean` replacing the default policy.                                           |
| `maxRetryAfterMs` | `number`                      | Cap on a `Retry-After` delay requested by the server (default `60000`).                                         |
| `responseType`    | `ResponseType`                | `json` (default) \| `text` \| `blob` \| `arrayBuffer` \| `formData`.                                            |
| `validateStatus`  | `(status: number) => boolean` | Which codes are accepted (default: the 2xx range).                                                              |
| `signal`          | `AbortSignal`                 | External signal for cancelling the request.                                                                     |

The `fetch` to use is injected separately, as the 2nd constructor argument:
`new SmartFetch(defaults, { fetch })` (`SmartFetchOptions`).

### Merge rules

Client defaults and per-request configuration are combined per field:

- **`headers`** merge **case-insensitively** — `content-type` and `Content-Type` are the same
  header, so they never go out duplicated. The request's value wins, and the header is emitted with
  **the capitalization the winning side wrote** (it is not canonicalized).
- **`params`** merge too, so a client-level default (an API key, a tenant id) survives a request
  that brings its own parameters. Same-key collisions go to the request; passing `null` or
  `undefined` drops the parameter entirely, which is how a client default is opted out of.
- Every other field is **replaced** by the request's value when present.

### Retries and request bodies

Retrying re-sends the same body, so the body has to survive being read twice. Strings, plain
objects, `URLSearchParams`, `Blob`, `ArrayBuffer`, typed arrays and `FormData` all do. A
**`ReadableStream` does not**: the first attempt drains it.

Rather than silently sending an empty body on the retry, a request combining `retries > 0` with a
stream body is rejected up front with a `SmartFetchError` (`type: 'request'`), before any network
call. Buffer the stream first, or set `retries: 0` for that request.

```ts
const client = new SmartFetch({ headers: { 'content-type': 'application/xml' } });
await client.post('/x', body, { headers: { 'Content-Type': 'application/json' } });
// sends exactly one header: Content-Type: application/json
```

```ts
const client = new SmartFetch({ params: { api_key: 'SECRET' } });
await client.get('/users', { params: { page: 1 } });
// -> /users?api_key=SECRET&page=1
```

## Response and errors

Every method resolves with a `SmartFetchResponse<T>`:

| Field        | Type                     | Description                                                                          |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------ |
| `data`       | `T`                      | Body parsed according to `responseType` (`null` on 204/205/304 and on every `HEAD`). |
| `status`     | `number`                 | HTTP status code.                                                                    |
| `statusText` | `string`                 | Status text.                                                                         |
| `headers`    | `Record<string, string>` | Response headers.                                                                    |
| `setCookie`  | `string[]`               | Every `Set-Cookie` header, uncollapsed (empty when there are none).                  |
| `ok`         | `boolean`                | `true` when the status counted as successful.                                        |
| `url`        | `string`                 | Final request URL.                                                                   |
| `config`     | `RequestConfig`          | Effective configuration used.                                                        |
| `raw`        | `Response`               | The untouched native `Response`.                                                     |

Failures are normalized into a typed error hierarchy. Everything extends `SmartFetchError`, which
exposes the `type` discriminator plus guards for narrowing:

| Error          | `type`      | Guard         | Own fields                          |
| -------------- | ----------- | ------------- | ----------------------------------- |
| `TimeoutError` | `'timeout'` | `isTimeout()` | `timeout`                           |
| `NetworkError` | `'network'` | `isNetwork()` | —                                   |
| `HttpError`    | `'http'`    | `isHttp()`    | `status`, `statusText`, `response?` |
| `ParseError`   | `'parse'`   | `isParse()`   | `responseType`, `text?`             |

```ts
try {
  await client.get('/resource');
} catch (e) {
  if (e instanceof SmartFetchError) {
    switch (e.type) {
      case 'http':
        /* e.status, e.response?.data */ break;
      case 'timeout':
        /* e.timeout */ break;
      case 'network':
        /* connection failure */ break;
      case 'parse':
        /* e.responseType, e.text */ break;
    }
  }
}
```

They all additionally carry `config` (the request that failed) and `cause` (the original error, if
any).

> **Identifying an error:** use `instanceof`, `error.type` or the `isX()` guards. The published
> bundle is minified, so `error.constructor.name` is mangled — `error.name` is set explicitly and
> stays correct.

## Design patterns

- **Adapter** — the client wraps the native `fetch` behind its own injectable interface.
- **Strategy** — `FixedBackoff` / `ExponentialBackoff`: interchangeable waits between retries.
- **Factory / Builder** — `createClient()` and `SmartFetchBuilder` for constructing clients.
- **Singleton** — the exported default instance (`import smartfetch from '@mathiascg05/smartfetch'`).
- **Interceptors (AOP)** — request/response hooks for cross-cutting concerns.

## Limitations and non-goals

SmartFetch is deliberately small. These are the things it does **not** do today — worth knowing
before adopting it:

- **No `RequestInit` passthrough for `credentials` / `mode` / `cache` / `redirect` / `keepalive`.**
  In practice this means **cookie-based authentication in the browser is not supported**.
- **Request headers only as `Record<string, string>`** — no `Headers` instances and no repeated
  multi-value request headers. On the response side, repeated `Set-Cookie` headers _are_ preserved
  in `response.setCookie`.
- **Tested on Node ≥ 18 only.** The code is runtime-agnostic and should work in browsers and edge
  runtimes, but no browser test suite backs that claim.

For production workloads needing any of the above, [axios](https://github.com/axios/axios),
[ky](https://github.com/sindresorhus/ky) or [ofetch](https://github.com/unjs/ofetch) are more
complete choices.

## Testing

```bash
npm install
npm run lint          # ESLint + Prettier rules
npm run typecheck     # tsc --noEmit
npm run test          # Jest (ESM)
npm run test:coverage # enforces a 100% threshold
npm run build         # dist/ (ESM + CJS + types)
npm run check:pack    # publint + arethetypeswrong
npm run size          # enforces the bundle budget
npm run example       # end-to-end smoke test against a real API
```

The suite is 117 tests across 9 files and covers 100% of statements, branches, functions and lines.
That threshold is enforced by `jest.config.mjs`, so an uncovered branch fails CI rather than
quietly eroding the number.

## Origin

Originally built as a university project for _Tópicos Especiales de Programación_, and maintained
since as an open-source learning project.

### Acknowledgments

Thanks to [@sjrisquez](https://github.com/sjrisquez), team partner during the academic phase of the
project.

## License

[MIT](./LICENSE)
