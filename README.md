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
