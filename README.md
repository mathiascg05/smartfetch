# SmartFetch

Wrapper avanzado y resiliente sobre la API nativa **`fetch`**, escrito en **TypeScript** y
**sin dependencias de terceros**. Ofrece una interfaz limpia y de alto nivel (estilo `axios`)
usando `fetch` por debajo: timeout configurable, reintentos automáticos, métodos HTTP completos
e interceptores.

> 🚧 En desarrollo. La documentación completa de instalación y uso se irá completando en los
> próximos commits (ver el plan del proyecto).

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
