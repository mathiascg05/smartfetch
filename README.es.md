# SmartFetch

[![CI](https://github.com/mathiascg05/smartfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/mathiascg05/smartfetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@mathiascg05/smartfetch.svg)](https://www.npmjs.com/package/@mathiascg05/smartfetch)
[![cobertura](https://img.shields.io/badge/cobertura-100%25-brightgreen.svg)](#pruebas)
[![tamaño](https://img.shields.io/badge/bundle%20ESM-3.8%20kB%20gzip-brightgreen.svg)](#pruebas)
[![mutation score](https://img.shields.io/badge/mutation%20score-88%25-green.svg)](#pruebas)
[![dependencias de runtime](https://img.shields.io/badge/dependencias%20de%20runtime-0-brightgreen.svg)](#)
[![licencia](https://img.shields.io/npm/l/@mathiascg05/smartfetch.svg)](./LICENSE)

Un wrapper de `fetch` construido alrededor de un motor de reintentos que se toma el fallo en serio.

La mayoría de clientes HTTP pequeños reintentan con una espera fija o exponencial y ahí se quedan.
SmartFetch añade lo que decide si reintentar sirve de algo:

- **Respeta `Retry-After`** en 429 y 503, en los dos formatos del RFC —segundos y fecha HTTP— con
  tope configurable. Si el servidor dice cuándo estará listo, eso gana a cualquier estimación del
  cliente.
- **El jitter viene activado.** Sin él, los clientes que fallan a la vez reintentan a la vez y
  repiten el pico que causó el fallo.
- **`totalTimeout` acota la operación completa**, esperas de backoff incluidas — no solo cada
  intento, así que los reintentos no convierten en silencio un presupuesto de 5 s en 40 s.
- **Un cuerpo que no se puede reenviar se rechaza de entrada.** Reintentar un `ReadableStream` ya
  consumido enviaría un cuerpo vacío; en su lugar la petición falla explicando por qué.

Alrededor de eso: los métodos HTTP completos, interceptores, un modelo de errores tipado que
distingue la cancelación del fallo de red, y cero dependencias de runtime.

> **TypeScript** · **Cero dependencias de runtime** · **Node ≥ 18, Chromium y edge** · **ESM + CJS**

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
- [Decisiones de diseño](#decisiones-de-diseño)
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
`FixedBackoff(delayMs = 0)` y `ExponentialBackoff(baseMs = 100, maxMs = Infinity, options)`. La
espera de backoff es cancelable por la `signal` externa.

`ExponentialBackoff` aplica **jitter por defecto**, para que los clientes que fallaron a la vez no
reintenten a la vez y repitan el pico de carga. Usa _equal jitter_: el retardo cae en
`[exponencial / 2, exponencial]`, lo que conserva un suelo de espera a diferencia del full jitter.
Se desactiva con `new ExponentialBackoff(100, Infinity, { jitter: false })` cuando se necesita un
retardo determinista.

Para políticas a medida, `retryOn` reemplaza la decisión por defecto:

### `Retry-After`

Ante un **429** o un **503**, el servidor puede indicar cuánto esperar mediante la cabecera
`Retry-After`, en segundos (`Retry-After: 120`) o como fecha HTTP. SmartFetch la respeta y le da
**precedencia sobre el backoff configurado**: el servidor sabe mejor que el cliente cuándo estará
listo.

La espera se acota con `maxRetryAfterMs` (un minuto por defecto), para que un servidor que pida una
hora no cuelgue la petición todo ese tiempo. Un valor ilegible cae al backoff configurado, y la
cabecera se ignora en códigos donde no significa "espera".

El `429` entra en la política de reintentos por defecto por el mismo motivo: es un límite de tasa
que se resuelve solo, no un error de quien llama.

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

Si la configuración puede traer cabeceras multi-valor, construye un `Headers` en lugar de hacer
spread — funciona con las tres formas:

```ts
client.interceptors.request.use((config) => {
  const headers = new Headers(config.headers);
  headers.set('Authorization', `Bearer ${token}`);
  config.headers = headers;
  return config;
});
```

## Referencia de configuración

`RequestConfig` (todos los campos son opcionales). Se puede pasar como configuración por defecto
del cliente y/o por petición; los valores de la petición se fusionan sobre los del cliente.

| Opción            | Tipo                          | Descripción                                                                                                                       |
| ----------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `baseURL`         | `string`                      | URL base a la que se resuelven las rutas relativas.                                                                               |
| `url`             | `string`                      | Ruta o URL de la petición (normalmente va como 1er argumento del método).                                                         |
| `method`          | `HttpMethod`                  | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` \| `HEAD` \| `OPTIONS`.                                                           |
| `headers`         | `HeadersInit`                 | Cabeceras HTTP: un `Headers`, un array de pares `[nombre, valor]` o un record. Se fusionan sin distinguir mayúsculas (ver abajo). |
| `params`          | `QueryParams`                 | Parámetros de consulta (se serializan a query string; admite arrays). Se fusionan con los del cliente (ver abajo).                |
| `body`            | `unknown`                     | Cuerpo; los objetos planos se serializan a JSON con su `Content-Type`.                                                            |
| `timeout`         | `number`                      | Milisegundos antes de abortar (`0`/omitido = sin límite). Acota un único intento.                                                 |
| `totalTimeout`    | `number`                      | Milisegundos para la operación completa, esperas de backoff incluidas (`0`/omitido = sin límite global).                          |
| `retries`         | `number`                      | Reintentos ante fallo transitorio (default `0` = un intento). Incompatible con un cuerpo de tipo stream — ver abajo.              |
| `backoff`         | `BackoffStrategy`             | Estrategia de espera entre reintentos (Strategy).                                                                                 |
| `retryOn`         | `RetryPredicate`              | Predicado `(error, attempt) => boolean` que sustituye la política por defecto.                                                    |
| `maxRetryAfterMs` | `number`                      | Tope para la espera que pida el servidor vía `Retry-After` (default `60000`).                                                     |
| `responseType`    | `ResponseType`                | `json` (default) \| `text` \| `blob` \| `arrayBuffer` \| `formData`.                                                              |
| `validateStatus`  | `(status: number) => boolean` | Qué códigos se aceptan (default: rango 2xx).                                                                                      |
| `signal`          | `AbortSignal`                 | Señal externa para cancelar la petición.                                                                                          |
| `credentials`     | `RequestCredentials`          | Si el navegador envía cookies/credenciales. **`'include'` habilita la auth por cookie en navegador.**                             |
| `mode`            | `RequestMode`                 | Modo de origen cruzado (`cors`, `no-cors`, `same-origin`, ...).                                                                   |
| `cache`           | `RequestCache`                | Interacción con la caché HTTP (`no-store`, `reload`, ...).                                                                        |
| `redirect`        | `RequestRedirect`             | Tratamiento de las redirecciones (`follow`, `error`, `manual`).                                                                   |
| `keepalive`       | `boolean`                     | Permite que la petición sobreviva a la página que la inició.                                                                      |
| `referrerPolicy`  | `ReferrerPolicy`              | Política de referrer aplicada a la petición.                                                                                      |
| `integrity`       | `string`                      | Metadatos de subresource-integrity verificados contra la respuesta.                                                               |

El `fetch` a usar se inyecta aparte, en el 2º argumento del constructor:
`new SmartFetch(defaults, { fetch })` (`SmartFetchOptions`).

### Cookies en el navegador

La autenticación por cookie necesita `credentials`, que es passthrough puro hacia `fetch`:

```ts
const api = new SmartFetch({
  baseURL: 'https://api.ejemplo.com',
  credentials: 'include', // envía cookies, también en origen cruzado
});
```

Todas las opciones de `RequestInit` de la tabla se propagan **solo si las defines**. Si omites una,
decide `fetch`, exactamente como si SmartFetch no estuviera.

### Reglas de fusión

La configuración por defecto del cliente y la de cada petición se combinan campo a campo:

- Las **`headers`** se fusionan **sin distinguir mayúsculas** — `content-type` y `Content-Type` son
  la misma cabecera, así que nunca se envían duplicadas. Gana el valor de la petición, y la cabecera
  se emite con **la capitalización que escribió quien gana** (no se canonicaliza).
- Los **`params`** también se fusionan, de modo que un valor por defecto del cliente (una API key,
  un id de tenant) sobrevive a una petición que traiga los suyos. Si la clave coincide gana la
  petición; pasar `null` o `undefined` elimina el parámetro, que es la forma de renunciar a un
  valor por defecto.
- **Cabeceras multi-valor**: un nombre que aporta la petición **reemplaza todos los valores que el
  cliente tuviera para ese nombre**, no se acumulan. Los repetidos _dentro_ de un mismo lado sí se
  conservan, que es la forma de enviar la misma cabecera dos veces. Ojo: `fetch` une los valores del
  mismo nombre en una sola línea separada por comas antes de enviarlos, que es la forma equivalente
  del RFC; no se pierde nada.
- El resto de campos se **reemplazan** por el valor de la petición cuando está presente.

### Reintentos y cuerpo de la petición

Reintentar reenvía el mismo cuerpo, así que este tiene que sobrevivir a que lo lean dos veces. El
texto, los objetos planos, `URLSearchParams`, `Blob`, `ArrayBuffer`, los typed arrays y `FormData`
lo hacen. Un **`ReadableStream` no**: el primer intento lo consume.

En lugar de enviar en silencio un cuerpo vacío en el reintento, una petición que combine
`retries > 0` con un cuerpo de tipo stream se rechaza de entrada con un `SmartFetchError`
(`type: 'request'`), antes de tocar la red. Bufferiza el stream primero, o pon `retries: 0` en esa
petición.

```ts
const client = new SmartFetch({ headers: { 'content-type': 'application/xml' } });
await client.post('/x', body, { headers: { 'Content-Type': 'application/json' } });
// envía exactamente una cabecera: Content-Type: application/json
```

```ts
const client = new SmartFetch({ params: { api_key: 'SECRET' } });
await client.get('/usuarios', { params: { page: 1 } });
// -> /usuarios?api_key=SECRET&page=1
```

## Respuesta y errores

Cada método resuelve con un `SmartFetchResponse<T>`:

| Campo        | Tipo                     | Descripción                                                                                          |
| ------------ | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `data`       | `T`                      | Cuerpo ya parseado según `responseType` (`null` en 204/205/304 y en todo `HEAD`).                    |
| `status`     | `number`                 | Código de estado HTTP.                                                                               |
| `statusText` | `string`                 | Texto del estado.                                                                                    |
| `headers`    | `Record<string, string>` | Cabeceras de la respuesta. **No incluye `set-cookie`** — ver `setCookie`.                            |
| `setCookie`  | `string[]`               | Todas las cabeceras `Set-Cookie`, en orden (vacío si no hay ninguna). El único sitio donde aparecen. |
| `ok`         | `boolean`                | `true` si el estado se consideró satisfactorio.                                                      |
| `url`        | `string`                 | URL final de la petición.                                                                            |
| `config`     | `RequestConfig`          | Configuración efectiva usada.                                                                        |
| `raw`        | `Response`               | El `Response` nativo sin procesar.                                                                   |

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

> **Para identificar un error:** usa `instanceof`, `error.type` o los guards `isX()`. El bundle
> publicado va minificado, así que `error.constructor.name` sale ofuscado — `error.name` se asigna
> explícitamente y sí es fiable.

## Patrones de diseño

- **Adapter** — el cliente envuelve `fetch` nativo tras una interfaz propia e inyectable.
- **Strategy** — `FixedBackoff` / `ExponentialBackoff`: espera entre reintentos intercambiable.
- **Factory / Builder** — `createClient()` y `SmartFetchBuilder` para construir clientes.
- **Singleton** — instancia por defecto exportada (`import smartfetch from '@mathiascg05/smartfetch'`).
- **Interceptores (AOP)** — hooks de petición/respuesta para preocupaciones transversales.

## Decisiones de diseño

Por qué la librería se comporta como se comporta. Cada uno de estos puntos fue una elección con una
alternativa más barata.

**Los reintentos vienen desactivados.** Una librería que reintenta sin que se lo pidan convierte una
petición en varias contra el servidor de otro, y puede amplificar una caída hasta una estampida.
Activarlos cuesta una línea; desactivar un comportamiento por defecto que no sabías que existía
cuesta una sesión de depuración.

**`Retry-After` gana al backoff configurado, pero con tope.** Un servidor que dice cuándo estará
listo sabe algo que el cliente no puede deducir. El tope existe porque esa confianza tiene un
límite: un servidor que pidiera una hora colgaría la petición una hora, así que la espera se acota
con `maxRetryAfterMs` (un minuto por defecto).

**El jitter viene activado y no se desactiva por petición.** Los clientes que fallan a la vez
reintentan a la vez, y esa ráfaga sincronizada repite el pico que causó el fallo. Hacerlo opcional
significaría que el comportamiento seguro solo llega a quien ya sabe pedirlo. Se puede desactivar al
construir `ExponentialBackoff`, donde la elección es explícita y local.

**Un cuerpo de tipo stream se rechaza antes de salir a la red si hay reintentos.** El primer intento
consume un `ReadableStream`, así que el reintento enviaría un cuerpo vacío: una corrupción silenciosa
y difícil de rastrear. Fallar de entrada con una explicación cuesta una petición y reporta el
problema real.

**`set-cookie` vive en `response.setCookie`, no en `response.headers`.** Un record plano no puede
contener una cabecera que aparece varias veces, así que dejarla ahí devolvería solo la última cookie
sin avisar. Es mejor que la clave no exista a que exista mintiendo.

**El `fetch` es inyectable.** Convierte la red en un parámetro en vez de en una global, que es lo que
permite que las pruebas corran sin mockear internos de módulos, que quien llama aporte un polyfill o
un cliente instrumentado, y que el mismo código funcione en Node, navegadores y edge sin un flag de
compilación.

## Pruebas

```bash
npm install
npm run lint          # reglas de ESLint + Prettier
npm run typecheck     # tsc --noEmit
npm run test          # Jest (ESM) — unitarias + integración en Node
npm run test:coverage # exige el umbral del 100%
npm run test:edge     # la misma librería dentro de un sandbox edge
npm run test:browser  # Chromium headless vía Playwright
npm run mutation      # StrykerJS
npm run build         # dist/ (ESM + CJS + tipos)
npm run check:pack    # publint + arethetypeswrong
npm run size          # impone el presupuesto de tamaño
npm run example       # prueba de humo end-to-end contra una API real
```

### Dónde se ejecutan realmente las pruebas

| Runtime       | Suite                         | Qué ejercita                                                       |
| ------------- | ----------------------------- | ------------------------------------------------------------------ |
| **Node ≥ 18** | Jest, unitarias + integración | Todo, contra un servidor `node:http` real                          |
| **Chromium**  | Vitest + Playwright           | El `fetch` real del navegador contra endpoints servidos por Vitest |
| **Edge**      | Jest + `@edge-runtime`        | La librería dentro de un sandbox de Workers/Vercel Edge            |

Las suites de integración y de navegador golpean HTTP real, no adaptadores simulados. La distinción
importa: nueve bugs de comportamiento sobrevivieron una vez a un 100% de cobertura de líneas
precisamente porque todas las pruebas pasaban por un `Response` fabricado a mano.

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
