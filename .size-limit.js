/**
 * Presupuesto de tamaño del bundle.
 *
 * El límite pasa de 4 KB a 5 KB de forma deliberada. Con 3.82 KB medidos, los 4 KB
 * anteriores dejaban 0.18 KB de margen: cualquier mejora del motor de reintentos
 * habría roto CI y la decisión de fondo —añadir la función o no— se habría tomado
 * por un número, no por su valor.
 *
 * El razonamiento es que **SmartFetch ya no compite por tamaño**. ky pesa ~3.3 KB y
 * ofetch ~3.0 KB, y ninguno trae a la vez `Retry-After`, jitter por defecto,
 * `totalTimeout` y rechazo explícito de reintentar cuerpos no reutilizables. Esa es
 * la propuesta, y cuesta algo de peso.
 *
 * Lo que el presupuesto sigue haciendo, y por eso no se elimina, es impedir que el
 * tamaño se degrade **en silencio**: 5 KB deja margen para crecer con intención,
 * pero no para triplicarse sin que nadie lo note.
 */
export default [
  {
    name: 'ESM entry (gzip)',
    path: 'dist/index.js',
    limit: '5 KB',
    gzip: true,
  },
];
