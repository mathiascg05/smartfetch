# SmartFetch

Wrapper avanzado y resiliente sobre la API nativa **`fetch`**, escrito en **TypeScript** y
**sin dependencias de terceros**. Ofrece una interfaz limpia y de alto nivel (estilo `axios`)
usando `fetch` por debajo: timeout configurable, reintentos automáticos, métodos HTTP completos
e interceptores.

> 🚧 En desarrollo. La documentación completa de instalación y uso se irá completando en los
> próximos commits (ver el plan del proyecto).

## Uso

```ts
import { SmartFetch, HttpError } from 'smartfetch';

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

// Errores controlados: HTTP (4xx/5xx) y de red.
try {
  await client.get('/usuarios/999');
} catch (error) {
  if (error instanceof HttpError) {
    console.error('HTTP', error.status, error.response?.data);
  }
}
```

La respuesta es un `SmartFetchResponse<T>` con `data`, `status`, `statusText`, `headers`, `ok`,
`url`, `config` y `raw` (el `Response` nativo). Por defecto el cuerpo se parsea como JSON; puede
cambiarse con `responseType: 'text' | 'blob' | 'arrayBuffer'`. El `fetch` subyacente es inyectable
(`new SmartFetch(defaults, { fetch })`) siguiendo el patrón Adapter.

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
- 🧱 Cero dependencias de runtime.
- 📦 Compatible con **async/await** y **Promesas**.

## Proyecto académico

Librería desarrollada como proyecto de la materia **Tópicos Especiales de Programación**.

## Licencia

MIT
