import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      // Processo principal compilado para bytecode do V8 (dificulta ler e alterar a lógica de licença)
      // O bytecode só roda na arquitetura em que foi gerado: NO_BYTECODE=1 para gerar o Mac Intel e o Windows num Mac Apple
      bytecode: process.env.NO_BYTECODE
        ? false
        : { transformArrowFunctions: true, protectedStrings: ['DSP1', 'Safe Storage'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // Preload com sandbox precisa ser CommonJS
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    resolve: {
      alias: { '@renderer': resolve('src/renderer/src'), ...shared }
    },
    plugins: [react(), tailwindcss()]
  }
})
