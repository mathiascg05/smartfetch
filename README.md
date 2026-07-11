# SmartFetch

Wrapper avanzado y resiliente sobre la API nativa **`fetch`**, escrito en **TypeScript** y
**sin dependencias de terceros**. Ofrece una interfaz limpia y de alto nivel (estilo `axios`)
usando `fetch` por debajo: timeout configurable, reintentos automáticos, métodos HTTP completos
e interceptores.

> 🚧 En desarrollo. La documentación completa de instalación y uso se irá completando en los
> próximos commits (ver el plan del proyecto).

## Uso

```ts
import { SmartFetch, HttpError, ParseError } from 'smartfetch';

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

La respuesta es un `SmartFetchResponse<T>` con `data`, `status`, `statusText`, `headers`, `ok`,
`url`, `config` y `raw` (el `Response` nativo). Por defecto el cuerpo se parsea como JSON; puede
cambiarse con `responseType: 'text' | 'blob' | 'arrayBuffer' | 'formData'`. Los estados sin cuerpo
(204/205/304) devuelven `data === null` en cualquier formato. El `fetch` subyacente es inyectable
(`new SmartFetch(defaults, { fetch })`) siguiendo el patrón Adapter.

### Creación de clientes

Además de `new SmartFetch(...)`, la librería ofrece dos formas de crear clientes y una instancia
lista para usar:

```ts
import smartfetch, { createClient, SmartFetchBuilder, ExponentialBackoff } from 'smartfetch';

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

### Parseo y normalización de errores

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

### Interceptores (Programación Orientada a Aspectos)

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

## Características previstas

- ⏱️ **Timeout** configurable por petición (cancelación automática vía `AbortController`).
- 🔁 **Reintentos** automáticos ante errores 5xx o de red (configurable, por defecto un solo intento).
- 🌐 Métodos **GET, POST, PUT, PATCH, DELETE**.
- 🔗 **Interceptores** de petición y respuesta (Programación Orientada a Aspectos).
- 🧩 **Parseo** configurable (`json`/`text`/`blob`/`arrayBuffer`/`formData`) con `ParseError` y `validateStatus`.
- 🏭 **Factory** (`createClient`), **Builder** (`SmartFetchBuilder`) e instancia por defecto (**Singleton**).
- 🧱 Cero dependencias de runtime.
- 📦 Compatible con **async/await** y **Promesas**.

## Proyecto académico

Librería desarrollada como proyecto de la materia **Tópicos Especiales de Programación**.

## Licencia

MIT
