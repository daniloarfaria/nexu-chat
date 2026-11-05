import { getDb } from '../db'
import { getAccount } from '../accounts'
import { listMessages, getChats, phoneOf } from '../wa/store'
import { listDeals } from '../deals'
import { complete, getAiSettings } from './router'
import { findPersonByJid } from '../people'
import type { MessageItem } from '@shared/types'

// ---------- Anonimização ----------

/**
 * Troca dados pessoais por marcadores antes de enviar à IA:
 * telefones, e-mails, CPF/CNPJ, CEP, cartões, links e os nomes conhecidos.
 * Função pura para teste.
 */
export function anonymize(text: string, names: string[] = []): string {
  let t = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[cartao]')
    .replace(/(\+?\d{2}\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .replace(/\b\d{5}-?\d{3}\b/g, '[cep]')
    .replace(/https?:\/\/\S+/g, '[link]')
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3 && !/^\+?\d/.test(n)))]
  // Nome completo e cada parte (≥ 3 letras) viram [cliente]
  const parts = [...new Set(clean.flatMap((n) => [n, ...n.split(/\s+/).filter((p) => p.length >= 3)]))].sort(
    (a, b) => b.length - a.length
  )
  for (const p of parts) {
    t = t.replace(
      new RegExp(`(?<![\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'),
      '[cliente]'
    )
  }
  return t
}

function transcript(msgs: MessageItem[], storeName: string, anon: boolean, names: string[]): string {
  return msgs
    .filter((m) => m.type !== 'system' && !m.deleted)
    .map((m) => {
      const who = m.fromMe ? storeName : 'Cliente'
      const body = m.text ?? `[${m.type}]`
      const line = `${who}: ${body}`
      return anon ? anonymize(line, names) : line
    })
    .join('\n')
}

function storeContext(accountId: string): { name: string; playbook: string | null } {
  const account = getAccount(accountId)
  const pb = getDb().prepare('SELECT content FROM playbooks WHERE account_id = ?').get(accountId) as
    { content: string } | undefined
  return { name: account?.name ?? 'Loja', playbook: pb?.content ?? null }
}

function namesFor(accountId: string, jid: string): string[] {
  const chat = getChats(accountId, [jid])[0]
  const person = findPersonByJid(accountId, jid)
  return [chat?.name, person?.name].filter(Boolean) as string[]
}

const BASE_RULES = `Você ajuda um pequeno comércio brasileiro a atender clientes pelo WhatsApp.
Escreva em português do Brasil, com tom cordial, direto e humano, como um atendente experiente da loja.
Nunca invente preços, prazos, estoque ou condições que não aparecem na conversa ou no playbook; se faltar informação, faça uma pergunta.
Mensagens curtas (até 3 frases), sem markdown, no máximo 1 emoji.`

// ---------- Tarefas ----------

/** Sugere a próxima resposta da loja (o atendente revisa antes de enviar). */
export async function suggestReply(
  accountId: string,
  jid: string,
  goal?: string
): Promise<{ text: string; provider: string }> {
  const { name, playbook } = storeContext(accountId)
  const anon = getAiSettings().privacy !== 'livre'
  const msgs = listMessages(accountId, jid, null, 30)
  if (!msgs.length) throw new Error('Esta conversa ainda não tem mensagens')
  const person = findPersonByJid(accountId, jid)
  const deals = listDeals(accountId, { chatJid: jid, limit: 5 })
  const history = deals.length
    ? 'Histórico de compras pelo WhatsApp: ' +
      deals
        .map((d) => (d.status === 'won' ? `comprou ${d.product ?? 'produto'}` : `não comprou (${d.reason})`))
        .join('; ')
    : ''
  const r = await complete({
    task: 'sugerir_resposta',
    tier: 'fast',
    customerData: true,
    system: `${BASE_RULES}\nLoja: ${name}.${playbook ? `\n\nPlaybook de vendas da loja:\n${playbook.slice(0, 6000)}` : ''}`,
    prompt: `Conversa (mais antiga primeiro):\n${transcript(msgs, name, anon, namesFor(accountId, jid))}\n\n${history}${
      person?.tags.length ? `\nEtiquetas do cliente: ${person.tags.join(', ')}` : ''
    }\n\n${goal ? `Objetivo da próxima mensagem: ${goal}\n` : ''}Escreva somente a próxima mensagem da loja, pronta para enviar. Se o cliente aparece como [cliente], não use nome.`,
    maxTokens: 600
  })
  return { text: r.text.replace(/^["']|["']$/g, '').trim(), provider: r.provider }
}

/** Gera variações de uma mensagem de campanha (sem dados de clientes). */
export async function campaignVariations(
  accountId: string,
  base: string,
  count: number,
  brief?: string
): Promise<string[]> {
  const { name, playbook } = storeContext(accountId)
  const r = await complete({
    task: 'variacoes_campanha',
    tier: 'smart',
    customerData: false,
    system: `${BASE_RULES}\nLoja: ${name}.${playbook ? `\nPlaybook:\n${playbook.slice(0, 3000)}` : ''}
Você escreve mensagens promocionais para clientes que já compraram na loja.
Cada variação deve ter o mesmo conteúdo e oferta, com palavras e estrutura diferentes, para não parecer mensagem em massa.
Mantenha exatamente as variáveis entre chaves que existirem, como {primeiro_nome}. Termine convidando o cliente a responder (pergunta simples).
Não use links. Até 5 linhas cada.`,
    prompt: `${brief ? `Briefing: ${brief}\n` : ''}Mensagem base:\n${base || '(crie a partir do briefing)'}\n\nEscreva ${count} variações. Separe cada uma com uma linha contendo apenas ---`,
    maxTokens: 2500
  })
  return r.text
    .split(/\n\s*-{3,}\s*\n/)
    .map((v) => v.replace(/^\s*(varia[cç][aã]o\s*\d+[:.)-]*|\d+[.)])\s*/i, '').trim())
    .filter((v) => v.length > 10)
    .slice(0, count)
}

/**
 * Monta o playbook de vendas a partir das conversas que viraram venda e das perdidas.
 * 1) resume cada conversa (modelo rápido)  2) sintetiza o playbook (modelo melhor).
 */
export async function buildPlaybook(
  accountId: string,
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  const { name, playbook } = storeContext(accountId)
  const anon = getAiSettings().privacy !== 'livre'
  const deals = listDeals(accountId, { from: Date.now() - 120 * 86_400_000, limit: 60 })
  if (deals.length < 3) throw new Error('Marque pelo menos 3 vendas ou perdas nas conversas para montar o playbook')
  const picked = [
    ...deals.filter((d) => d.status === 'won').slice(0, 25),
    ...deals.filter((d) => d.status === 'lost').slice(0, 15)
  ]
  const notes: string[] = []
  let done = 0
  for (const d of picked) {
    const msgs = listMessages(accountId, d.chatJid, Math.floor(d.createdAt / 1000) + 3600, 40)
    if (msgs.length >= 2) {
      try {
        const r = await complete({
          task: 'analisar_conversa',
          tier: 'fast',
          customerData: true,
          system:
            'Você analisa conversas de vendas de uma loja pelo WhatsApp. Responda em português, em tópicos curtos.',
          prompt: `Resultado: ${d.status === 'won' ? `VENDA${d.product ? ` (${d.product})` : ''}` : `PERDIDA (motivo: ${d.reason})`}\n\nConversa:\n${transcript(
            msgs,
            name,
            anon,
            namesFor(accountId, d.chatJid)
          )}\n\nListe: 1) como o cliente chegou e o que queria; 2) objeções; 3) o que a loja fez que ajudou ou atrapalhou; 4) frases da loja que funcionaram (copie literalmente).`,
          maxTokens: 700
        })
        notes.push(`### ${d.status === 'won' ? 'Venda' : 'Perdida'}\n${r.text}`)
      } catch {
        /* segue com as demais */
      }
    }
    onProgress?.(++done, picked.length)
  }
  if (!notes.length) throw new Error('Não foi possível analisar as conversas agora. Tente novamente mais tarde.')
  const r = await complete({
    task: 'playbook',
    tier: 'smart',
    customerData: false, // só resumos já anonimizados
    system: `Você é consultor de vendas de pequenos comércios. Escreva em português do Brasil, em Markdown simples (títulos ## e listas).`,
    prompt: `Loja: ${name}.\n${playbook ? `Playbook atual (atualize, mantendo o que continua válido):\n${playbook}\n\n` : ''}Análises de ${notes.length} conversas recentes:\n\n${notes.join('\n\n')}\n\nEscreva o playbook de vendas pelo WhatsApp desta loja com as seções:\n## Abordagens que funcionam\n## Objeções mais comuns e como responder\n## Frases prontas (exemplos reais que funcionaram)\n## O que evitar\n## Quando fazer follow-up\nUse só o que aparece nas análises; não invente números.`,
    maxTokens: 4000
  })
  getDb()
    .prepare(
      'INSERT INTO playbooks (account_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
    )
    .run(accountId, r.text, Date.now())
  return r.text
}

export function getPlaybook(accountId: string): { content: string; updatedAt: number } | null {
  const r = getDb().prepare('SELECT content, updated_at FROM playbooks WHERE account_id = ?').get(accountId) as
    { content: string; updated_at: number } | undefined
  return r ? { content: r.content, updatedAt: r.updated_at } : null
}

export function savePlaybook(accountId: string, content: string): void {
  getDb()
    .prepare(
      'INSERT INTO playbooks (account_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
    )
    .run(accountId, content.slice(0, 50_000), Date.now())
}

export { phoneOf }
