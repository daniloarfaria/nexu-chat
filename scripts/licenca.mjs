#!/usr/bin/env node
// Emissão de licenças do Nexu Chat (uso interno da agência).
//
//   node scripts/licenca.mjs chaves                      → cria o par de chaves (uma única vez)
//   node scripts/licenca.mjs emitir --cliente "Ótica X" --plano completo --contas 1 --meses 1
//   node scripts/licenca.mjs emitir --cliente "Ótica X" --plano marketing --validade 2026-12-31 --documento 12.345.678/0001-90
//   node scripts/licenca.mjs emitir --cliente "Agência Ark (interno)" --plano completo --contas 10 --sem-vencimento
//   node scripts/licenca.mjs ver DSP1....                → mostra o conteúdo de uma chave
//
// A chave PRIVADA fica em ~/.config/disparador/licenca-privada.pem (nunca vai para o git nem para o app).
// O registro de tudo que foi emitido fica em ~/.config/disparador/licencas-emitidas.csv
import { generateKeyPairSync, createPrivateKey, sign, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = process.env.DISPARADOR_LICENCA_DIR ?? join(homedir(), '.config', 'disparador')
const PRIV = join(DIR, 'licenca-privada.pem')
const LOG = join(DIR, 'licencas-emitidas.csv')
const PUB_TS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'license-key.ts')

const PLANS = {
  basico: ['conversas'],
  marketing: [
    'conversas',
    'campanhas',
    'antiban',
    'lembretes',
    'respostasAuto',
    'gruposEnvio',
    'gruposExtrair',
    'gruposCriar',
    'gruposModeracao',
    'funil',
    'status',
    'perfilIa'
  ],
  completo: [
    'conversas',
    'campanhas',
    'antiban',
    'gruposEnvio',
    'gruposExtrair',
    'gruposCriar',
    'gruposModeracao',
    'respostasAuto',
    'lembretes',
    'vendas',
    'funil',
    'ia',
    'status',
    'perfilIa'
  ]
}

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const flag = (name) => process.argv.includes(`--${name}`)
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function issue(privatePem, opts) {
  const plano = opts.plano ?? 'completo'
  if (!PLANS[plano]) throw new Error(`Plano inválido: ${plano} (use basico, marketing ou completo)`)
  const payload = {
    v: 1,
    id: `LIC-${randomBytes(4).toString('hex').toUpperCase()}`,
    cliente: String(opts.cliente).trim(),
    ...(opts.documento ? { documento: String(opts.documento) } : {}),
    plano,
    contas: Math.max(1, Number(opts.contas ?? 1)),
    modulos: opts.modulos ?? PLANS[plano],
    emitida: ymd(new Date()),
    validade: opts.validade ?? null
  }
  if (!payload.cliente) throw new Error('Informe --cliente')
  const head = `DSP1.${b64url(JSON.stringify(payload))}`
  const sig = sign(null, Buffer.from(head), createPrivateKey(privatePem))
  return { key: `${head}.${b64url(sig)}`, payload }
}

function main() {
  const cmd = process.argv[2]
  if (cmd === 'chaves') {
    if (existsSync(PRIV)) {
      console.error(
        `Já existe uma chave privada em ${PRIV}. Não sobrescrevo (as licenças emitidas deixariam de valer).`
      )
      process.exit(1)
    }
    mkdirSync(DIR, { recursive: true, mode: 0o700 })
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    chmodSync(PRIV, 0o600)
    const pub = publicKey.export({ type: 'spki', format: 'pem' })
    writeFileSync(
      PUB_TS,
      `// Chave PÚBLICA de licenças (gerada por scripts/licenca.mjs chaves). A privada fica só com a agência.\nexport const LICENSE_PUBLIC_KEY = \`${pub}\`\n`
    )
    console.log(`Chave privada: ${PRIV}  (guarde um backup em lugar seguro!)\nChave pública gravada em ${PUB_TS}`)
    return
  }
  if (cmd === 'emitir') {
    if (!existsSync(PRIV)) throw new Error('Rode antes: node scripts/licenca.mjs chaves')
    let validade = arg('validade') ?? null
    if (!validade && !flag('sem-vencimento')) {
      const d = new Date()
      d.setMonth(d.getMonth() + Number(arg('meses') ?? 1))
      validade = ymd(d)
    }
    const { key, payload } = issue(readFileSync(PRIV, 'utf8'), {
      cliente: arg('cliente'),
      documento: arg('documento'),
      plano: arg('plano'),
      contas: arg('contas'),
      validade
    })
    if (!existsSync(LOG)) appendFileSync(LOG, 'id;cliente;documento;plano;contas;emitida;validade;chave\n')
    appendFileSync(
      LOG,
      [
        payload.id,
        payload.cliente,
        payload.documento ?? '',
        payload.plano,
        payload.contas,
        payload.emitida,
        payload.validade ?? 'sem vencimento',
        key
      ].join(';') + '\n'
    )
    console.log(
      `\nLicença ${payload.id} — ${payload.cliente} — plano ${payload.plano}, ${payload.contas} conta(s), válida até ${payload.validade ?? 'sem vencimento'}\n\n${key}\n`
    )
    return
  }
  if (cmd === 'ver') {
    const k = process.argv[3] ?? ''
    console.log(
      JSON.parse(Buffer.from(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    )
    return
  }
  console.log(
    'Uso: node scripts/licenca.mjs chaves | emitir --cliente "Nome" [--plano completo|marketing|basico] [--contas 1] [--meses 1 | --validade AAAA-MM-DD | --sem-vencimento] [--documento CNPJ] | ver <chave>'
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error('Erro:', e.message)
    process.exit(1)
  }
}
