// Configuração das medições de desempenho. Rodar da raiz do projeto:
//   NEXU_PERF_DIR=/caminho/de/trabalho npx vitest run --config scripts/perf/vitest.perf.config.ts scripts/perf/01-banco-e-migracoes.perf.ts
//   NEXU_PERF_DIR=/caminho/de/trabalho npx vitest run --config scripts/perf/vitest.perf.config.ts scripts/perf/02-consultas.perf.ts
// Rodar nessa ordem: a etapa 02 lê o banco produzido pela etapa 01.
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['scripts/perf/*.perf.ts', 'scripts/perf/*.perf.tsx'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000
  }
})
