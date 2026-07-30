/**
 * Configuración de mutation testing (StrykerJS).
 *
 * La cobertura de líneas dice qué código se ejecuta; el mutation testing dice si
 * las pruebas realmente lo **verifican**. Este proyecto llegó a tener 100% de
 * cobertura con nueve bugs de comportamiento dentro, así que la distinción no es
 * teórica.
 *
 * El runner de Jest necesita `--experimental-vm-modules` porque la suite es ESM;
 * se pasa a través de `NODE_OPTIONS` en el script `npm run mutation`.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: 'jest.config.mjs',
    enableFindRelatedTests: true,
  },
  // Solo se mutan las fuentes de la librería: los tests y la configuración no.
  mutate: ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageAnalysis: 'perTest',
  tempDirName: '.stryker-tmp',
  // Umbral fijado sobre el 88.76% realmente alcanzado. `break` se deja en 87 como
  // margen de estabilidad: 82 de los mutantes se matan por timeout, y eso depende
  // de la carga de la máquina. El margen es el mismo criterio de siempre —un par
  // de puntos por debajo de lo medido—, no una rebaja para que pase una corrida
  // fallida. Sube conforme suban las pruebas: 80 -> 85 -> 87.
  thresholds: { high: 92, low: 87, break: 87 },
  timeoutMS: 20000,
  // Las pruebas de integración y de plazos hacen esperas reales, así que un
  // mutante que dispare un backoff largo necesita margen antes de declararse
  // "timeout" en lugar de "survived".
  timeoutFactor: 3,
};
