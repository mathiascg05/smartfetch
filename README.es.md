# SmartFetch

[![CI](https://github.com/mathiascg05/smartfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/mathiascg05/smartfetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@mathiascg05/smartfetch.svg)](https://www.npmjs.com/package/@mathiascg05/smartfetch)
[![cobertura](https://img.shields.io/badge/cobertura-100%25-brightgreen.svg)](#pruebas)
[![dependencias de runtime](https://img.shields.io/badge/dependencias%20de%20runtime-0-brightgreen.svg)](#)
[![licencia](https://img.shields.io/npm/l/@mathiascg05/smartfetch.svg)](./LICENSE)

Wrapper resiliente sobre la API nativa **`fetch`**, escrito en **TypeScript** y **sin dependencias
de runtime**. Ofrece una interfaz limpia y de alto nivel (estilo `axios`) apoyándose en `fetch` por
debajo: timeout configurable, reintentos automáticos con estrategias de espera intercambiables,
métodos HTTP completos, interceptores y un modelo de errores tipado.

> **TypeScript** · **Cero dependencias de runtime** · **Node ≥ 18** · **ESM + CJS** · async/await y Promesas

🇬🇧 [Read this in English](./README.md)

## Índice

- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Creación de clientes](#creación-de-clientes)
- [Timeout](#timeout)
- [Reintentos y backoff](#reintentos-y-backoff)
- [Parseo y `validateStatus`](#parseo-y-validatestatus)
- [Interceptores](#interceptores)
- [Referencia de configuración](#referencia-de-configuración)
- [Respuesta y errores](#respuesta-y-errores)
- [Patrones de diseño](#patrones-de-diseño)
- [Limitaciones](#limitaciones)
- [Pruebas](#pruebas)
- [Origen](#origen)
- [Licencia](#licencia)

## Instalación

SmartFetch usa `fetch` nativo, por lo que requiere **Node.js ≥ 18** (o cualquier runtime moderno
con `fetch` global).

```bash
npm install @mathiascg05/smartfetch
```

También puede instalarse directamente desde el repositorio:

```bash
npm install github:mathiascg05/smartfetch
```

El paquete expone **ESM** (`dist/index.js`), **CommonJS** (`dist/index.cjs`) y declaraciones de
tipos (`dist/index.d.ts`), así que funciona tanto con `import` como con `require`:

```ts
import smartfetch, { SmartFetch } from '@mathiascg05/smartfetch'; // ESM / TypeScript
```

```js
const { SmartFetch } = require('@mathiascg05/smartfetch'); // CommonJS
```

## Uso rápido

```ts
import { SmartFetch, HttpError, ParseError } from '@mathiascg05/smartfetch';

const client = new SmartFetch({ baseURL: 'https://api.ejemplo.com' });

// GET con parámetros de consulta y tipado del cuerpo de la respuesta.
const { data, status } = await client.get<Usuario[]>('/usuarios', { params: { page: 1 } });
console.log(status, data);

// POST/PUT/PATCH: el cuerpo va como 2º argumento (estilo axios). Si es un objeto
// plano se serializa a JSON y se añade Content-Type: application/json automáticamente.
const creado = await client.post<Usuario>('/usuarios', { nombre: 'Ada' });
await client.put<Usuario>('/usuarios/1', { nombre: 'Ada Lovelace' });
await client.patch<Usuario>('/usuarios/1', { activo: false });

// DELETE no recibe cuerpo posicional.
await client.delete('/usuarios/1');

// Errores controlados: HTTP (4xx/5xx), de red y de parseo del cuerpo.
try {
  await client.get('/usuarios/999');
} catch (error) {
  if (error instanceof HttpError) {
    console.error('HTTP', error.status, error.response?.data);
  } else if (error instanceof ParseError) {
    // El cuerpo de una respuesta satisfactoria no era JSON válido.
    console.error('Parseo', error.responseType, error.text);
  }
}
```

Cada método devuelve una **`Promise`**, así que funcionan por igual `async/await` y las cadenas
`.then()`/`.catch()`:

```ts
client
  .get<Usuario[]>('/usuarios')
  .then((res) => console.log(res.data))
  .catch((err) => console.error(err));
```

La respuesta es un `SmartFetchResponse<T>` con `data`, `status`, `statusText`, `headers`, `ok`,
`url`, `config` y `raw` (el `Response` nativo). Por defecto el cuerpo se parsea como JSON; puede
cambiarse con `responseType: 'text' | 'blob' | 'arrayBuffer' | 'formData'`. Los estados sin cuerpo
(204/205/304) devuelven `data === null` en cualquier formato. El `fetch` subyacente es inyectable
(`new SmartFetch(defaults, { fetch })`) siguiendo el patrón Adapter.

## Creación de clientes

Además de `new SmartFetch(...)`, la librería ofrece dos formas de crear clientes y una instancia
lista para usar:

```ts
import smartfetch, {
  createClient,
  SmartFetchBuilder,
  ExponentialBackoff,
} from '@mathiascg05/smartfetch';

// 1) Factory: crea un cliente sin usar `new`.
const api = createClient({ baseURL: 'https://api.ejemplo.com', timeout: 5000 });

// 2) Builder: compone la configuración paso a paso (fluent API).
const api2 = new SmartFetchBuilder()
  .baseURL('https://api.ejemplo.com')
  .header('Authorization', 'Bearer token')
  .timeout(5000)
  .retries(2)
  .backoff(new ExponentialBackoff())
  .build();

// 3) Singleton: instancia por defecto (default export) para llamadas rápidas.
const { data } = await smartfetch.get('https://api.ejemplo.com/estado');
```

`createClient` (patrón **Factory**) y `SmartFetchBuilder` (patrón **Builder**) producen ambos una
instancia de `SmartFetch`; el `default export` `smartfetch` es un cliente por defecto (patrón
**Singleton**) sin configuración base, útil para peticiones puntuales con URLs absolutas.

## Timeout

`timeout` (en milisegundos) cancela la petición y lanza un `TimeoutError` si el servidor no
responde a tiempo. La cancelación se implementa internamente con `AbortController`. Un valor de
`0` o su omisión significan **sin límite de tiempo**.

```ts
import { TimeoutError } from '@mathiascg05/smartfetch';

try {
  await client.get('/lento', { timeout: 2000 }); // aborta a los 2 s
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error(`La petición superó los ${error.timeout} ms`);
  }
}
```

Si pasas tu propia `signal` (`AbortSignal`), se combina con el timeout interno: aborta lo que
ocurra primero. Un aborto externo se propaga tal cual (no se traduce a `TimeoutError`).

## Reintentos y backoff

SmartFetch reintenta automáticamente las peticiones que fallan de forma **transitoria**. Por
defecto `retries: 0` (un solo intento). La política por defecto reintenta **solo** ante:

- errores de red (`NetworkError`), y
- respuestas HTTP **5xx** (`HttpError` con `status` 500–599).

**No** reintenta ante timeouts, errores 4xx ni errores de parseo (`ParseError`).

```ts
import { SmartFetch, FixedBackoff, ExponentialBackoff } from '@mathiascg05/smartfetch';

// 2 reintentos (3 intentos en total) con espera exponencial: 100 ms, 200 ms, 400 ms...
const client = new SmartFetch({
  baseURL: 'https://api.ejemplo.com',
  retries: 2,
  backoff: new ExponentialBackoff(100), // baseMs = 100, maxMs = Infinity
});

// Espera fija entre reintentos (patrón Strategy intercambiable).
const otro = new SmartFetch({ retries: 3, backoff: new FixedBackoff(500) });
```

La estrategia de espera es un **Strategy** intercambiable (`BackoffStrategy`):
`FixedBackoff(delayMs = 0)` y `ExponentialBackoff(baseMs = 100, maxMs = Infinity)`. La espera de
backoff es cancelable por la `signal` externa.

Para políticas a medida, `retryOn` reemplaza la decisión por defecto:

```ts
// Reintentar también en 429 (Too Many Requests), hasta 4 intentos.
await client.get('/recurso', {
  retries: 3,
  retryOn: (error, attempt) =>
    error instanceof HttpError && (error.status === 429 || error.status >= 500),
});
```

## Parseo y `validateStatus`

Un cuerpo ilegible en el formato solicitado (p. ej. JSON malformado) en una respuesta **aceptada**
lanza un `ParseError` (con `responseType`, el `text` crudo y la `cause` original). En una respuesta
**de error**, en cambio, prevalece el `HttpError` y el cuerpo crudo queda disponible en
`error.response?.data`, para no ocultar el fallo HTTP tras un problema de parseo.

Por defecto solo el rango **2xx** se considera satisfactorio; puede redefinirse por petición con
`validateStatus`, que decide qué códigos se aceptan (resuelven) y cuáles se rechazan con `HttpError`:

```ts
// Aceptar también 304 (Not Modified) como éxito.
await client.get('/recurso', {
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
});
```

## Interceptores

Los interceptores permiten tratar de forma centralizada preocupaciones transversales —logging,
autenticación, transformación de datos o recuperación de errores— sin tocar el núcleo del cliente.

```ts
// Interceptor de petición: se ejecuta antes de enviar. Ideal para autenticación o logging.
const authId = client.interceptors.request.use((config) => {
  config.headers = { ...config.headers, Authorization: 'Bearer ' + token };
  return config;
});

// Interceptor de respuesta: transforma la respuesta ya recibida.
client.interceptors.response.use((response) => {
  console.log(`${response.config.method} ${response.url} -> ${response.status}`);
  return response;
});

// El 2º argumento maneja errores y puede recuperarse devolviendo una respuesta de fallback.
client.interceptors.response.use(undefined, (error) => {
  if (error instanceof HttpError && error.status >= 500) {
    return { ...error.response, data: { offline: true } };
  }
  throw error; // se relanza para propagarlo si no se puede recuperar
});

// use() devuelve un id para eliminar el interceptor más tarde.
client.interceptors.request.eject(authId);
```

Los interceptores de petición se ejecutan en orden inverso al de registro (LIFO) y los de respuesta
en orden de registro (FIFO), igual que en `axios`.

## Referencia de configuración

`RequestConfig` (todos los campos son opcionales). Se puede pasar como configuración por defecto
del cliente y/o por petición; los valores de la petición se fusionan sobre los del cliente.

| Opción           | Tipo                          | Descripción                                                                    |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `baseURL`        | `string`                      | URL base a la que se resuelven las rutas relativas.                            |
| `url`            | `string`                      | Ruta o URL de la petición (normalmente va como 1er argumento del método).      |
| `method`         | `HttpMethod`                  | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE`.                               |
| `headers`        | `Record<string, string>`      | Cabeceras HTTP.                                                                |
| `params`         | `QueryParams`                 | Parámetros de consulta (se serializan a query string; admite arrays).          |
| `body`           | `unknown`                     | Cuerpo; los objetos planos se serializan a JSON con su `Content-Type`.         |
| `timeout`        | `number`                      | Milisegundos antes de abortar (`0`/omitido = sin límite).                      |
| `retries`        | `number`                      | Reintentos ante fallo transitorio (default `0` = un intento).                  |
| `backoff`        | `BackoffStrategy`             | Estrategia de espera entre reintentos (Strategy).                              |
| `retryOn`        | `RetryPredicate`              | Predicado `(error, attempt) => boolean` que sustituye la política por defecto. |
| `responseType`   | `ResponseType`                | `json` (default) \| `text` \| `blob` \| `arrayBuffer` \| `formData`.           |
| `validateStatus` | `(status: number) => boolean` | Qué códigos se aceptan (default: rango 2xx).                                   |
| `signal`         | `AbortSignal`                 | Señal externa para cancelar la petición.                                       |

El `fetch` a usar se inyecta aparte, en el 2º argumento del constructor:
`new SmartFetch(defaults, { fetch })` (`SmartFetchOptions`).

## Respuesta y errores

Cada método resuelve con un `SmartFetchResponse<T>`:

| Campo        | Tipo                     | Descripción                                                      |
| ------------ | ------------------------ | ---------------------------------------------------------------- |
| `data`       | `T`                      | Cuerpo ya parseado según `responseType` (`null` en 204/205/304). |
| `status`     | `number`                 | Código de estado HTTP.                                           |
| `statusText` | `string`                 | Texto del estado.                                                |
| `headers`    | `Record<string, string>` | Cabeceras de la respuesta.                                       |
| `ok`         | `boolean`                | `true` si el estado se consideró satisfactorio.                  |
| `url`        | `string`                 | URL final de la petición.                                        |
| `config`     | `RequestConfig`          | Configuración efectiva usada.                                    |
| `raw`        | `Response`               | El `Response` nativo sin procesar.                               |

Los fallos se normalizan a una jerarquía de errores tipada. Todos extienden `SmartFetchError`,
que expone el discriminador `type` y guards para estrechar el tipo:

| Error          | `type`      | Guard         | Campos propios                      |
| -------------- | ----------- | ------------- | ----------------------------------- |
| `TimeoutError` | `'timeout'` | `isTimeout()` | `timeout`                           |
| `NetworkError` | `'network'` | `isNetwork()` | —                                   |
| `HttpError`    | `'http'`    | `isHttp()`    | `status`, `statusText`, `response?` |
| `ParseError`   | `'parse'`   | `isParse()`   | `responseType`, `text?`             |

```ts
try {
  await client.get('/recurso');
} catch (e) {
  if (e instanceof SmartFetchError) {
    switch (e.type) {
      case 'http':
        /* e.status, e.response?.data */ break;
      case 'timeout':
        /* e.timeout */ break;
      case 'network':
        /* fallo de conexión */ break;
      case 'parse':
        /* e.responseType, e.text */ break;
    }
  }
}
```

Todos comparten además `config` (la petición que falló) y `cause` (el error original, si lo hubo).

## Patrones de diseño

- **Adapter** — el cliente envuelve `fetch` nativo tras una interfaz propia e inyectable.
- **Strategy** — `FixedBackoff` / `ExponentialBackoff`: espera entre reintentos intercambiable.
- **Factory / Builder** — `createClient()` y `SmartFetchBuilder` para construir clientes.
- **Singleton** — instancia por defecto exportada (`import smartfetch from '@mathiascg05/smartfetch'`).
- **Interceptores (AOP)** — hooks de petición/respuesta para preocupaciones transversales.

## Limitaciones

SmartFetch es deliberadamente pequeño. Esto es lo que **no** hace hoy, y conviene saberlo antes de
adoptarlo:

- **No expone `credentials` / `mode` / `cache` / `redirect` / `keepalive` de `RequestInit`.** En la
  práctica esto significa que **la autenticación por cookies en el navegador no está soportada**.
- **No hay `HEAD` ni `OPTIONS`**: solo `GET`, `POST`, `PUT`, `PATCH` y `DELETE`.
- **Cabeceras solo como `Record<string, string>`**: sin instancias de `Headers` ni cabeceras
  repetidas de valor múltiple.
- **No se respeta la cabecera `Retry-After`** en 429/503; siempre manda el backoff configurado.
- **`ExponentialBackoff` no aplica jitter**, así que varios clientes concurrentes pueden reintentar
  sincronizados.
- **Probado solo en Node ≥ 18.** El código es agnóstico al runtime y debería funcionar en
  navegadores y edge runtimes, pero no hay una suite de pruebas de navegador que lo respalde.

Para cargas de producción que necesiten cualquiera de esas cosas, [axios](https://github.com/axios/axios),
[ky](https://github.com/sindresorhus/ky) u [ofetch](https://github.com/unjs/ofetch) son opciones
más completas.

## Pruebas

```bash
npm install
npm run lint          # reglas de ESLint + Prettier
npm run typecheck     # tsc --noEmit
npm run test          # Jest (ESM)
npm run test:coverage # exige el umbral del 100%
npm run build         # dist/ (ESM + CJS + tipos)
npm run example       # prueba de humo end-to-end contra una API real
```

La suite son 117 pruebas repartidas en 9 archivos y cubre el 100% de sentencias, ramas, funciones y
líneas. Ese umbral lo impone `jest.config.mjs`, de modo que una rama sin cubrir rompe CI en lugar de
erosionar el número en silencio.

## Origen

Desarrollado originalmente como proyecto de la materia **Tópicos Especiales de Programación**, y
mantenido desde entonces como proyecto open source de aprendizaje.

### Agradecimientos

Gracias a [@sjrisquez](https://github.com/sjrisquez), compañero de equipo durante la fase académica
del proyecto.

## Licencia

[MIT](./LICENSE)
