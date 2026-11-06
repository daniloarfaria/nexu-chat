import { useState } from 'react'
import { Sparkles, Store } from 'lucide-react'
import type { BusinessContext, BusinessContextField } from '@shared/types'
import { useAction, useLoad } from '../../lib/useAsync'
import { timeAgo } from '../../lib/format'
import { Button, Drawer, Field, Notice, Section, Textarea } from '../../components/ui'

// Mesma ordem de prioridade do processo principal (src/main/ai/context.ts)
const FIELDS: Array<{ key: BusinessContextField; label: string; hint: string; rows: number; placeholder: string }> = [
  {
    key: 'about',
    label: 'O que a loja vende e para quem',
    hint: 'Uma ou duas frases.',
    rows: 2,
    placeholder: 'Ótica de bairro. Óculos de grau, de sol e lentes de contato para a família toda.'
  },
  {
    key: 'products',
    label: 'Produtos e serviços, com preço e prazo',
    hint: 'Um por linha. A IA só fala de preço e prazo que estiverem aqui.',
    rows: 5,
    placeholder: 'Lente multifocal: a partir de R$ ..., pronta em ... dias'
  },
  {
    key: 'hours',
    label: 'Horário de funcionamento e endereço',
    hint: '',
    rows: 2,
    placeholder: 'Segunda a sexta, 9h às 18h. Sábado, 9h às 13h. Rua ..., nº ...'
  },
  { key: 'payment', label: 'Formas de pagamento', hint: '', rows: 2, placeholder: 'Pix, cartão em até ...x, dinheiro' },
  {
    key: 'policies',
    label: 'Troca, garantia e entrega',
    hint: '',
    rows: 3,
    placeholder: 'Troca em até ... dias com nota. Garantia de ... meses na armação.'
  },
  {
    key: 'faq',
    label: 'Perguntas frequentes',
    hint: 'Uma pergunta e resposta por linha.',
    rows: 4,
    placeholder: 'P: Fazem exame de vista? R: ...'
  },
  {
    key: 'tone',
    label: 'Tom de voz',
    hint: 'Como a loja fala com os clientes.',
    rows: 2,
    placeholder: 'Próximo e simpático, chama o cliente pelo nome, sem gírias.'
  },
  {
    key: 'forbidden',
    label: 'O que a IA não pode falar',
    hint: 'É o que tem mais prioridade: nunca é cortado.',
    rows: 3,
    placeholder: 'Não prometer desconto. Não falar de concorrentes. Não dar diagnóstico de saúde.'
  }
]

/** Mesmo limite do processo principal (CONTEXT_MAX_CHARS). */
const MAX_CHARS = 5000

function FillDrawer({
  accountId,
  onDone,
  onClose
}: {
  accountId: string
  onDone: (r: Partial<BusinessContext>) => void
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const { busy, error, run } = useAction()
  return (
    <Drawer
      title="Preencher com a IA"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy === 'f'}
            disabled={text.trim().length < 20}
            onClick={async () => {
              const r = await run('f', () => window.api.invoke('ai:context-fill', { accountId, text }))
              if (r) onDone(r)
            }}
          >
            <Sparkles className="size-4" /> Organizar nos campos
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info">
          Cole o texto do site, do Instagram ou do catálogo da loja. A IA separa nos campos e você revisa antes de
          salvar. Este texto normalmente vai para a IA na nuvem (a Groq ou outro provedor cadastrado); não cole dados de
          clientes.
        </Notice>
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label="Texto sobre a loja" htmlFor="ctx-fill">
          <Textarea
            id="ctx-fill"
            rows={16}
            maxLength={20_000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Cole aqui..."
          />
        </Field>
      </div>
    </Drawer>
  )
}

export function MeuNegocio({ accountId }: { accountId: string }): React.JSX.Element {
  const saved = useLoad(() => window.api.invoke('ai:context-get', { accountId }), [accountId])
  const [draft, setDraft] = useState<Partial<BusinessContext> | null>(null)
  const [filling, setFilling] = useState(false)
  const [filled, setFilled] = useState(false)
  const [ok, setOk] = useState(false)
  const { busy, error, run } = useAction()
  if (!saved.data) return <div className="text-[13px] text-ink-3">{saved.error ?? 'Carregando…'}</div>
  const value = (k: BusinessContextField): string => draft?.[k] ?? saved.data![k]
  const total = FIELDS.reduce((n, f) => n + value(f.key).trim().length, 0)

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={<Store className="size-4" />}>
        O que estiver aqui a IA usa em tudo: sugestões de resposta, versões de campanha e playbook. Ela é orientada a
        não inventar preço, prazo ou desconto que não esteja escrito aqui. Vale só para este número de WhatsApp.
      </Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      {filled && <Notice tone="ok">A IA preencheu os campos que achou no texto. Revise e clique em Salvar.</Notice>}
      {ok && !draft && <Notice tone="ok">Salvo.</Notice>}
      <Section
        title="Meu negócio"
        description={saved.data.updatedAt ? `Atualizado ${timeAgo(saved.data.updatedAt)}` : 'Ainda não preenchido.'}
        actions={
          <Button onClick={() => setFilling(true)}>
            <Sparkles className="size-4" /> Preencher com a IA
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`ctx-${f.key}`} hint={f.hint || undefined}>
              <Textarea
                id={`ctx-${f.key}`}
                rows={f.rows}
                maxLength={4000}
                value={value(f.key)}
                placeholder={f.placeholder}
                onChange={(e) => {
                  setOk(false)
                  setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                }}
              />
            </Field>
          ))}
          <div className="flex items-center gap-3">
            <span className="tabular text-[12.5px] text-ink-3">
              {total.toLocaleString('pt-BR')} caracteres
              {total > MAX_CHARS &&
                ` · passou de ${MAX_CHARS.toLocaleString('pt-BR')}: a IA recebe uma parte, cortando primeiro as perguntas frequentes e o tom de voz`}
            </span>
            <span className="ml-auto" />
            {draft && (
              <Button variant="ghost" onClick={() => (setDraft(null), setFilled(false))}>
                Desfazer
              </Button>
            )}
            <Button
              variant="primary"
              loading={busy === 's'}
              disabled={!draft}
              onClick={async () => {
                const r = await run('s', () =>
                  window.api.invoke('ai:context-save', { accountId, context: draft ?? {} })
                )
                if (r) {
                  setDraft(null)
                  setFilled(false)
                  setOk(true)
                  void saved.reload()
                }
              }}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Section>
      {filling && (
        <FillDrawer
          accountId={accountId}
          onClose={() => setFilling(false)}
          onDone={(r) => {
            setDraft((d) => ({ ...d, ...r }))
            setFilled(true)
            setFilling(false)
          }}
        />
      )}
    </div>
  )
}
