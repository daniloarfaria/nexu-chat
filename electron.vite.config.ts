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
      bytecode: { transformArrowFunctions: true, protectedStrings: ['DSP1', 'Safe Storage'] },
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
