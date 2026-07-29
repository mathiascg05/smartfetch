# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-07-29

Endurecimiento a partir de una auditoría externa: nueve bugs de comportamiento
que vivían **dentro** de un 100% de cobertura, más el empaquetado y las pruebas
que permitieron que pasaran desapercibidos.

### Added

- `totalTimeout`: presupuesto de tiempo para la operación completa, incluidas las
  esperas de backoff. `timeout` solo acota cada intento, así que con reintentos el
  tiempo total no tenía techo.
- Soporte de la cabecera `Retry-After` (RFC 9110) en 429 y 503, en formato de
  segundos y de fecha HTTP, con precedencia sobre el backoff configurado y tope
  configurable vía `maxRetryAfterMs` (60 s por defecto).
- Jitter en `ExponentialBackoff`, **activado por defecto**, para que clientes
  concurrentes no reintenten sincronizados. Configurable con `{ jitter: false }`.
- `response.setCookie: string[]`, que expone todas las cabeceras `Set-Cookie` sin
  colapsarlas.
- `CancelledError` y la categoría `'cancelled'`, con el guard `isCancelled()`.
- Suite de pruebas de integración contra un servidor `node:http` real.
- Mutation testing con StrykerJS, además de la cobertura de líneas.
- Validación de empaquetado en CI (`publint` + `arethetypeswrong`) y presupuesto
  de tamaño con `size-limit`.
- Referencia de API generada con typedoc y publicada en GitHub Pages.
- Workflow de publicación en npm con procedencia (provenance) vía OIDC.

### Changed

Cambios de comportamiento observables. **Rompen compatibilidad**:

- Cancelar una petición lanza ahora `CancelledError` en lugar de `NetworkError`.
  Un `catch` que filtre por `NetworkError` deja de capturar las cancelaciones.
- `new SmartFetch()` sin un `fetch` disponible ya no lanza al construir; el
  adaptador se resuelve al hacer la petición. Como efecto secundario, un polyfill
  cargado después de crear el cliente ahora sí se recoge.
- `429 Too Many Requests` entra en la política de reintentos por defecto.
- `ExponentialBackoff.delay()` deja de ser determinista por el jitter.
- El bundle publicado va minificado (8.69 KB → 3.6 KB gzip), así que
  `error.constructor.name` sale ofuscado. `error.name`, `error.type`, `instanceof`
  y los guards `isX()` siguen siendo fiables y son la forma soportada.
- Las condiciones de `exports` llevan sus propios `types`, de modo que quien
  consume con `require()` recibe las declaraciones CommonJS correctas.

### Fixed

- Cancelar una petición con `retries` producía reintentos fantasma: 4 llamadas a
  la red con `retries: 3`. Con un adaptador que comprueba `signal.aborted` al
  entrar —como hace `fetch` real— el reintento además se colgaba indefinidamente.
- Las cabeceras que diferían solo en mayúsculas se enviaban duplicadas, y `fetch`
  las concatenaba en un único valor separado por comas.
- Los `params` por defecto del cliente se perdían en cuanto la petición traía los
  suyos: el spread reemplazaba el objeto entero.
- Importar la librería lanzaba en cualquier runtime sin `fetch` global, que es
  justo el runtime donde haría falta inyectar un adaptador propio.
- Un interceptor de petición que olvidaba el `return` producía un `TypeError`
  crudo desde las tripas del cliente, fuera del modelo de errores.
- Reintentar con un cuerpo de tipo `ReadableStream` reenviaba un cuerpo ya
  consumido; ahora se rechaza de entrada con un error que explica por qué.
- Las cabeceras `Set-Cookie` repetidas se colapsaban y se perdían todas menos una.
- Un corte de conexión a mitad del cuerpo escapaba como `TypeError: terminated`,
  fuera del modelo de errores e invisible para la política de reintentos.
- `Date.parse` aceptaba laxamente valores basura en `Retry-After` (`"-5"`) y los
  leía como fechas pasadas, convirtiendo una cabecera malformada en una espera de
  cero en vez de caer al backoff.

## [1.0.0] - 2026-07-13

### Added

- `SmartFetch` HTTP client wrapping the native `fetch` (Adapter pattern) with an
  injectable adapter.
- Full HTTP verb set: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Configurable timeout backed by `AbortController`, composable with an external
  `AbortSignal`.
- Retry engine with pluggable backoff strategies (`FixedBackoff`,
  `ExponentialBackoff`) and a customizable `retryOn` predicate.
- Request and response interceptors with LIFO/FIFO ordering, error handling and
  recovery.
- Typed error hierarchy: `SmartFetchError`, `TimeoutError`, `NetworkError`,
  `HttpError` and `ParseError`, with `type` discriminator and narrowing guards.
- Response parsing via `responseType` (`json`, `text`, `blob`, `arrayBuffer`,
  `formData`), with `null` normalization for body-less statuses (204/205/304).
- Configurable success criteria through `validateStatus`.
- Client creation helpers: `createClient` (Factory), `SmartFetchBuilder` (Builder)
  and a default `smartfetch` singleton.
- Dual ESM + CommonJS build with type declarations.

[Unreleased]: https://github.com/mathiascg05/smartfetch/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/mathiascg05/smartfetch/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/mathiascg05/smartfetch/releases/tag/v1.0.0
