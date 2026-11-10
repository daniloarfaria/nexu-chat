import type { LocalModelTier } from '@shared/types'

/**
 * O que a IA no computador baixa. Versões, endereços e SHA-256 FIXOS: o app só aceita estes arquivos.
 * Conferidos em 06/11/2026:
 * - motor: release b12143 do llama.cpp (github.com/ggml-org/llama.cpp), campo `digest` da API do GitHub;
 *   o pacote do Mac Apple Silicon também foi baixado e conferido com `shasum -a 256`.
 * - modelos: API do Hugging Face (`lfs.oid` = SHA-256 do arquivo), com o commit do repositório fixado na URL;
 *   o modelo leve também foi baixado e conferido com `shasum -a 256`.
 * Para atualizar: troque versão, URL, tamanho e SHA juntos e rode `node scripts/medir-ia-local.mjs` de novo.
 */

export interface PinnedFile {
  url: string
  sha256: string
  size: number
  /** nome do arquivo baixado */
  file: string
}

export const ENGINE_VERSION = 'b12143'

const GH = `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_VERSION}`

/** Motor `llama-server` por sistema e processador. Windows: versão só com CPU (roda em qualquer PC, sem driver). */
export const ENGINE_ASSETS: Record<string, PinnedFile> = {
  'darwin-arm64': {
    file: `llama-${ENGINE_VERSION}-bin-macos-arm64.tar.gz`,
    url: `${GH}/llama-${ENGINE_VERSION}-bin-macos-arm64.tar.gz`,
    sha256: '83dd79b6d4caf3106a30d48a1237f3a391af772e94d796ba9c3322076cfea851',
    size: 16_672_169
  },
  'darwin-x64': {
    file: `llama-${ENGINE_VERSION}-bin-macos-x64.tar.gz`,
    url: `${GH}/llama-${ENGINE_VERSION}-bin-macos-x64.tar.gz`,
    sha256: 'eaf1cd682da34b289f00e4ee5d4c413ca5b9709372fe21bb492cbfba7ae70f01',
    size: 12_410_543
  },
  'win32-x64': {
    file: `llama-${ENGINE_VERSION}-bin-win-cpu-x64.zip`,
    url: `${GH}/llama-${ENGINE_VERSION}-bin-win-cpu-x64.zip`,
    sha256: '41ff350f7f4cef938ecaa4cb69e91cd79adfe76d09652f4bd7e325988dad7b99',
    size: 24_731_243
  }
}

export function engineAssetFor(platform: string, arch: string): PinnedFile | null {
  return ENGINE_ASSETS[`${platform}-${arch}`] ?? null
}

export interface LocalModelSpec extends PinnedFile {
  id: string
  tier: LocalModelTier
  name: string
  /** tamanho do contexto em tokens (conversas já vão resumidas) */
  ctx: number
  /** memória mínima do computador para oferecer este modelo */
  minRamGb: number
  /** argumentos extras do llama-server para este modelo */
  extraArgs: string[]
}

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    // Padrão. Gemma 3 1B instruct, Q4_K_M (Google, publicado pela organização oficial do llama.cpp).
    // Multilíngue (inclui português), 806 MB: cabe no teto de ~1,2 GB de memória em uso.
    id: 'gemma3-1b',
    tier: 'leve',
    name: 'Gemma 3 1B (leve)',
    file: 'gemma-3-1b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/f9c28bcd85737ffc5aef028638d3341d49869c27/gemma-3-1b-it-Q4_K_M.gguf',
    sha256: '8ccc5cd1f1b3602548715ae25a66ed73fd5dc68a210412eea643eb20eb75a135',
    size: 806_058_240,
    ctx: 4096,
    minRamGb: 0,
    extraArgs: []
  },
  {
    // Opcional, só com 16 GB ou mais e se a loja ligar. Qwen3 4B Q4_K_M (repositório oficial da Qwen).
    // Sem o modo "pensando" para responder rápido.
    id: 'qwen3-4b',
    tier: 'medio',
    name: 'Qwen3 4B (médio)',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf',
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    size: 2_497_280_256,
    ctx: 4096,
    minRamGb: 16,
    extraArgs: ['--reasoning', 'off']
  }
]

export const lightModel = (): LocalModelSpec => LOCAL_MODELS.find((m) => m.tier === 'leve')!
export const mediumModel = (): LocalModelSpec => LOCAL_MODELS.find((m) => m.tier === 'medio')!
export const modelById = (id: string): LocalModelSpec | undefined => LOCAL_MODELS.find((m) => m.id === id)
