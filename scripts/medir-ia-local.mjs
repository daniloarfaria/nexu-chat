#!/usr/bin/env node
// Medição da IA no computador (motor llama-server + modelo leve), como o app roda.
//
//   node scripts/medir-ia-local.mjs                     → baixa (se precisar) e mede o modelo leve
//   node scripts/medir-ia-local.mjs --modelo medio      → mede o modelo médio (2,5 GB)
//   node scripts/medir-ia-local.mjs --pasta ~/ia-teste  → pasta onde guardar motor e modelo
//   node scripts/medir-ia-local.mjs --ctx 2048          → outro tamanho de contexto
//   node scripts/medir-ia-local.mjs --sem-gpu           → só processador (simula PC sem placa de vídeo)
//   node scripts/medir-ia-local.mjs --extra "--repack"  → argumentos a mais para o llama-server (comparar opções)
//
// Imprime: tempo para abrir, memória em repouso (modelo carregado, parado), memória de pico
// durante 3 pedidos em português e o tempo de cada pedido.
// Mantenha versões, URLs e SHA-256 iguais a src/main/ai/local/catalog.ts (há teste conferindo).
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { cpus, homedir, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ENGINE_VERSION = 'b12143'
const GH = `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_VERSION}`
const ENGINE = {
  'darwin-arm64': {
    file: `llama-${ENGINE_VERSION}-bin-macos-arm64.tar.gz`,
    sha256: '83dd79b6d4caf3106a30d48a1237f3a391af772e94d796ba9c3322076cfea851'
  },
  'darwin-x64': {
    file: `llama-${ENGINE_VERSION}-bin-macos-x64.tar.gz`,
    sha256: 'eaf1cd682da34b289f00e4ee5d4c413ca5b9709372fe21bb492cbfba7ae70f01'
  },
  'win32-x64': {
    file: `llama-${ENGINE_VERSION}-bin-win-cpu-x64.zip`,
    sha256: '41ff350f7f4cef938ecaa4cb69e91cd79adfe76d09652f4bd7e325988dad7b99'
  }
}
const MODELS = {
  leve: {
    file: 'gemma-3-1b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/f9c28bcd85737ffc5aef028638d3341d49869c27/gemma-3-1b-it-Q4_K_M.gguf',
    sha256: '8ccc5cd1f1b3602548715ae25a66ed73fd5dc68a210412eea643eb20eb75a135',
    extra: []
  },
  medio: {
    file: 'Qwen3-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf',
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    extra: ['--reasoning', 'off']
  }
}

const PROMPTS = [
  {
    nome: 'classificar intenção',
    system: 'Classifique a intenção do cliente. Responda só com uma palavra: compra, duvida, reclamacao ou outro.',
    user: 'Oi, quanto custa a lente multifocal? Queria fazer meu óculos ainda essa semana.',
    max: 10
  },
  {
    nome: 'sugerir resposta',
    system:
      'Você é atendente de uma ótica no WhatsApp. Escreva em português do Brasil, cordial, até 3 frases. Nunca invente preços.\nContexto da loja:\nLoja: Ótica Centro\nHorário: seg a sex, 9h às 18h; sábado, 9h às 13h.\nProdutos: exame de vista grátis na compra de óculos completo.',
    user: 'Cliente: Vocês abrem no sábado? Preciso trocar a armação.\nEscreva só a próxima mensagem da loja.',
    max: 120
  },
  {
    nome: 'tirar data da conversa',
    system:
      'Extraia a data mencionada pelo cliente no formato AAAA-MM-DD. Hoje é 2026-11-06. Responda só a data ou "nenhuma".',
    user: 'Pode marcar meu exame para a próxima quinta, dia 12?',
    max: 20
  }
]

const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : d
}
const tier = arg('--modelo', 'leve')
const dir = arg('--pasta', join(homedir(), '.cache', 'nexu-ia-local'))
const ctx = Number(arg('--ctx', '4096'))
const threads = Math.max(1, Math.floor(cpus().length / 2))
const model = MODELS[tier]
if (!model) throw new Error('Use --modelo leve ou --modelo medio')
const asset = ENGINE[`${process.platform}-${process.arch}`]
if (!asset) throw new Error(`Sem motor para ${process.platform}-${process.arch}`)

async function sha256(p) {
  const h = createHash('sha256')
  await pipeline(createReadStream(p), h)
  return h.digest('hex')
}

async function baixar(url, dest, sha) {
  if (existsSync(dest) && (await sha256(dest)) === sha) return dest
  mkdirSync(dirname(dest), { recursive: true })
  const part = dest + '.part'
  const start = existsSync(part) ? statSync(part).size : 0
  const res = await fetch(url, { headers: start ? { range: `bytes=${start}-` } : {} })
  if (!res.ok && res.status !== 416) throw new Error(`download ${res.status}`)
  if (res.status !== 416) {
    const total = (Number(res.headers.get('content-length')) || 0) + (res.status === 206 ? start : 0)
    let got = res.status === 206 ? start : 0
    let last = 0
    const body = Readable.fromWeb(res.body)
    body.on('data', (c) => {
      got += c.length
      if (Date.now() - last > 1000) {
        last = Date.now()
        process.stdout.write(`\r  ${(got / 1e6).toFixed(0)} de ${(total / 1e6).toFixed(0)} MB`)
      }
    })
    await pipeline(body, createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' }))
    process.stdout.write('\n')
  }
  const got = await sha256(part)
  if (got !== sha) {
    rmSync(part, { force: true })
    throw new Error(`SHA-256 diferente em ${url}: ${got}`)
  }
  renameSync(part, dest)
  return dest
}

function acharBinario(d) {
  const nome = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  for (const e of readdirSync(d, { withFileTypes: true, recursive: true }))
    if (e.isFile() && e.name === nome) return join(e.parentPath, e.name)
  return null
}

async function motor() {
  const pasta = join(dir, 'engine', ENGINE_VERSION)
  if (existsSync(pasta) && acharBinario(pasta)) return acharBinario(pasta)
  console.log('Baixando o motor', ENGINE_VERSION)
  const arq = await baixar(`${GH}/${asset.file}`, join(dir, 'downloads', asset.file), asset.sha256)
  mkdirSync(pasta, { recursive: true })
  const tar =
    process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
  execFileSync(tar, ['-xf', arq, '-C', pasta])
  if (process.platform === 'darwin') {
    try {
      execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', pasta])
    } catch {
      /* sem marca */
    }
  }
  return acharBinario(pasta)
}

const porta = () =>
  new Promise((ok) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => ok(p))
    })
  })

/** Memória do processo em MB: residente (RSS) e, no Mac, o "footprint" (o que o Monitor de Atividade mostra). */
function memoria(pid) {
  if (process.platform === 'win32') {
    const out = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${pid}).WorkingSet64`
    ]).toString()
    return { rss: Number(out.trim()) / 1048576, footprint: null }
  }
  const rss =
    Number(
      execFileSync('ps', ['-o', 'rss=', '-p', String(pid)])
        .toString()
        .trim()
    ) / 1024
  let footprint = null
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('footprint', ['-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      const m = /phys_footprint:\s*([\d.]+)\s*([KMG])B/i.exec(out) ?? /Footprint:\s*([\d.]+)\s*([KMG])B/i.exec(out)
      if (m) footprint = Number(m[1]) * { K: 1 / 1024, M: 1, G: 1024 }[m[2].toUpperCase()]
    } catch {
      /* footprint indisponível */
    }
  }
  return { rss, footprint }
}

const mb = (n) => (n == null ? '-' : `${Math.round(n)} MB`)

async function main() {
  console.log(
    `Computador: ${process.platform}-${process.arch}, ${(totalmem() / 1024 ** 3).toFixed(1)} GB, ${cpus().length} núcleos (${cpus()[0]?.model})`
  )
  const bin = await motor()
  console.log('Baixando/conferindo o modelo', model.file)
  const modelo = await baixar(model.url, join(dir, 'models', model.file), model.sha256)
  const port = await porta()
  const key = 'medicao'
  // como o app: a chave vai num arquivo, não na linha de comando
  const keyFile = join(dir, `chave-${port}.txt`)
  writeFileSync(keyFile, key + '\n', { mode: 0o600 })
  // mesmos argumentos do app (src/main/ai/local/engine.ts → engineArgs)
  const args = ['--model', modelo, '--host', '127.0.0.1', '--port', String(port), '--api-key-file', keyFile, '--ctx-size', String(ctx),
    '--threads', String(threads), '--threads-batch', String(threads), '--parallel', '1', '--load-mode', 'mmap',
    '--cache-ram', '0', '--no-repack', '--no-webui', '--no-slots', ...model.extra,
    ...(process.argv.includes('--sem-gpu') ? ['--n-gpu-layers', '0'] : []),
    ...(arg('--extra', '') ? arg('--extra', '').split(' ') : [])] // prettier-ignore
  const t0 = Date.now()
  const proc = spawn(bin, args, { cwd: dirname(bin), stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  proc.stderr.on('data', (b) => (log = (log + b).slice(-4000)))
  let pico = { rss: 0, footprint: 0 }
  const amostra = () => {
    try {
      const m = memoria(proc.pid)
      pico = { rss: Math.max(pico.rss, m.rss), footprint: Math.max(pico.footprint ?? 0, m.footprint ?? 0) }
      return m
    } catch {
      return null
    }
  }
  const timer = setInterval(amostra, 150)
  try {
    for (;;) {
      if (proc.exitCode != null) throw new Error('motor fechou:\n' + log)
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${key}` } })
        if (r.ok) break
      } catch {
        /* abrindo */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    const abrir = Date.now() - t0
    await new Promise((r) => setTimeout(r, 1500))
    const repouso = amostra()
    const resultados = []
    for (const p of PROMPTS) {
      const t = Date.now()
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'local',
          max_tokens: p.max,
          messages: [
            { role: 'system', content: p.system },
            { role: 'user', content: p.user }
          ]
        })
      })
      const j = await res.json()
      resultados.push({
        nome: p.nome,
        ms: Date.now() - t,
        tokens: j.usage?.completion_tokens ?? 0,
        resposta: (j.choices?.[0]?.message?.content ?? JSON.stringify(j)).replace(/\s+/g, ' ').trim().slice(0, 160)
      })
    }
    await new Promise((r) => setTimeout(r, 1500))
    const depois = amostra()
    clearInterval(timer)
    const gpu =
      (process.argv.includes('--sem-gpu') ? ' · só processador' : '') +
      (arg('--extra', '') ? ` · ${arg('--extra', '')}` : '')
    console.log(`\nModelo: ${model.file} · contexto ${ctx} · ${threads} threads · motor ${ENGINE_VERSION}${gpu}`)
    console.log(`Tempo para abrir (carregar o modelo): ${(abrir / 1000).toFixed(1)} s`)
    console.log(`Memória em repouso (carregado, parado): RSS ${mb(repouso?.rss)} · footprint ${mb(repouso?.footprint)}`)
    console.log(`Memória de pico (durante os pedidos):  RSS ${mb(pico.rss)} · footprint ${mb(pico.footprint || null)}`)
    console.log(`Memória depois dos pedidos:            RSS ${mb(depois?.rss)} · footprint ${mb(depois?.footprint)}`)
    for (const r of resultados) {
      const tps = r.tokens ? ` · ${(r.tokens / (r.ms / 1000)).toFixed(1)} tokens/s` : ''
      console.log(`- ${r.nome}: ${(r.ms / 1000).toFixed(2)} s${tps}\n    → ${r.resposta}`)
    }
  } finally {
    clearInterval(timer)
    proc.kill()
    rmSync(keyFile, { force: true })
  }
  console.log('\nMotor desligado (memória liberada).')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
