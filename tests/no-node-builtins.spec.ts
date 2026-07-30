import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La librería no debe depender de nada específico de Node.
 *
 * Es la comprobación que respalda de verdad la afirmación de "agnóstico del
 * runtime". La suite edge no puede hacerla: el arnés de Jest filtra `process` y
 * `Buffer` dentro de su sandbox, así que allí su ausencia no es observable. Aquí
 * sí, leyendo las fuentes.
 *
 * Es además una prueba estática y barata que falla en el momento en que alguien
 * añade un `import ... from 'node:fs'` a `src/`, en lugar de descubrirse cuando
 * un despliegue en edge o en navegador revienta.
 */
describe('independencia del runtime', () => {
  /** Devuelve todos los `.ts` de un directorio, recursivamente. */
  function fuentes(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        return fuentes(ruta);
      }
      return entrada.name.endsWith('.ts') ? [ruta] : [];
    });
  }

  const archivos = fuentes('src');

  it('encuentra las fuentes que va a inspeccionar', () => {
    // Si el glob dejara de encontrar nada, el resto de la suite pasaría en vacío.
    expect(archivos.length).toBeGreaterThanOrEqual(8);
  });

  it.each(archivos)('%s no importa módulos internos de Node', (archivo) => {
    const contenido = readFileSync(archivo, 'utf8');

    expect(contenido).not.toMatch(/from\s+['"]node:/);
    expect(contenido).not.toMatch(/require\(['"]node:/);
    // Los nombres sin prefijo también cuentan: 'fs', 'http', 'buffer', ...
    expect(contenido).not.toMatch(/from\s+['"](fs|path|http|https|stream|buffer|url|util)['"]/);
  });

  it.each(archivos)('%s no usa globales exclusivas de Node', (archivo) => {
    const contenido = readFileSync(archivo, 'utf8');

    // `process` y `Buffer` existen en Node pero no en navegador ni en edge.
    expect(contenido).not.toMatch(/\bprocess\.[a-z]/i);
    expect(contenido).not.toMatch(/\bBuffer\./);
  });
});
