import type { ChatAiState } from '@shared/types'

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info'

const WAIT_REASON: Record<string, string> = {
  pediu_humano: 'O cliente pediu uma pessoa',
  risco: 'O cliente escreveu uma reclamação',
  sem_resposta: 'A IA não soube responder com segurança',
  midia: 'O cliente enviou um arquivo ou foto',
  fechar_venda: 'O cliente está pronto para fechar a compra',
  limite_hora: 'A IA atingiu o limite de respostas por hora',
  limite_conversa: 'A IA atingiu o limite de respostas desta conversa',
  limite_dia: 'O limite diário de envios foi atingido',
  ia_fora: 'A IA não conseguiu responder (provedor fora do ar)'
}

/** O que mostrar na etiqueta da conversa (quem está atendendo). */
export function robotLabel(ai: Pick<ChatAiState, 'mode' | 'reason'> | null | undefined): {
  text: string
  tone: Tone
  hint?: string
} | null {
  if (!ai) return null
  if (ai.mode === 'espera') return { text: 'Esperando atendente', tone: 'warn', hint: WAIT_REASON[ai.reason ?? ''] }
  if (ai.mode === 'humano') return { text: 'Atendimento humano', tone: 'neutral' }
  if (ai.reason === 'retomou') return { text: 'IA retomou o atendimento', tone: 'accent' }
  return { text: 'IA atendendo', tone: 'accent' }
}
