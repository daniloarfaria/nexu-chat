import { dialog, app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ModuleKey } from '@shared/types'
import type { Handle } from './ipc'
import { getAccount } from './accounts'
import * as people from './people'
import * as C from './campaigns'
import { engine } from './engine'
import * as rules from './automation'
import * as groups from './groups'
import * as reminders from './reminders'
import * as deals from './deals'
import * as ai from './ai/router'
import * as assistant from './ai/assistant'
import { wa } from './wa/manager'
import { sendAndStore } from './wa/send'
import { renderTemplate, OPT_OUT_FOOTER, firstName } from '@shared/rules'

const accountId = z.string().uuid()
const id = z.number().int().positive()
const jid = z
  .string()
  .max(120)
  .regex(/^[\w.:-]+@(s\.whatsapp\.net|lid|g\.us)$/)
const groupJid = z
  .string()
  .max(120)
  .regex(/^[\w.-]+@g\.us$/)
const tag = z.string().trim().min(1).max(40)
const bytes = z.instanceof(Uint8Array)
const audience = z
  .object({
    type: z.enum(['tags', 'all', 'groups', 'list']),
    tags: z.array(tag).max(50).optional(),
    excludeTags: z.array(tag).max(50).optional(),
    groups: z.array(groupJid).max(500).optional(),
    personIds: z.array(id).max(50_000).optional()
  })
  .strict()

function need(acc: string, ...mods: ModuleKey[]): void {
  const a = getAccount(acc)
  if (!a) throw new Error('Conta não encontrada')
  const off = mods.filter((m) => !a.modules[m])
  if (off.length && off.length === mods.length)
    throw new Error('Este módulo está desligado. Ative em Configurações → Módulos.')
}

function sock(acc: string): NonNullable<ReturnType<typeof wa.getSocket>> {
  const s = wa.getSocket(acc)
  if (!s) throw new Error('O WhatsApp desta conta não está conectado')
  return s
}

function campaignOf(cid: number): ReturnType<typeof C.getCampaign> & object {
  const c = C.getCampaign(cid)
  if (!c) throw new Error('Campanha não encontrada')
  return c
}

async function saveCsv(win: BrowserWindow | null, name: string, csv: string): Promise<void> {
  const opts = { defaultPath: join(app.getPath('downloads'), name), filters: [{ name: 'CSV', extensions: ['csv'] }] }
  const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))
  if (!r.canceled && r.filePath) writeFileSync(r.filePath, csv, 'utf8')
}

const stamp = (): string => new Date().toISOString().slice(0, 10)

export function registerBusinessIpc(handle: Handle, getWindow: () => BrowserWindow | null): void {
  // ---------- Contatos ----------
  handle(
    'people:list',
    z
      .object({
        accountId,
        search: z.string().max(100).optional(),
        tag: tag.nullable().optional(),
        optOut: z.enum(['all', 'only', 'exclude']).optional(),
        limit: z.number().int().min(1).max(500),
        offset: z.number().int().min(0)
      })
      .strict(),
    (a) => people.listPeople(a)
  )
  handle('people:tags', z.object({ accountId }).strict(), (a) => people.listTags(a.accountId))
  handle('people:fields', z.object({ accountId }).strict(), (a) => people.customFieldNames(a.accountId))
  handle(
    'people:save',
    z
      .object({
        accountId,
        id: id.optional(),
        name: z.string().max(120),
        phone: z.string().max(30),
        birthday: z.string().max(20).nullable().optional(),
        fields: z.record(z.string().max(40), z.string().max(500)).optional(),
        tags: z.array(tag).max(30).optional()
      })
      .strict(),
    (a) => people.savePerson(a.accountId, a)
  )
  handle('people:delete', z.object({ accountId, ids: z.array(id).max(50_000) }).strict(), (a) =>
    people.deletePeople(a.accountId, a.ids)
  )
  handle('people:opt-out', z.object({ accountId, ids: z.array(id).max(50_000), value: z.boolean() }).strict(), (a) =>
    people.setOptOut(a.accountId, a.ids, a.value)
  )
  handle('people:tag', z.object({ accountId, ids: z.array(id).max(50_000), tag, add: z.boolean() }).strict(), (a) =>
    people.bulkTag(a.accountId, a.ids, a.tag, a.add)
  )
  handle('people:import-preview', z.object({ data: bytes, sheet: z.string().max(100).optional() }).strict(), (a) =>
    people.previewImport(a.data, a.sheet)
  )
  handle(
    'people:import',
    z
      .object({
        accountId,
        token: z.string().uuid(),
        mapping: z.object({
          name: z.number().int().min(0).nullable(),
          phone: z.number().int().min(0).nullable(),
          birthday: z.number().int().min(0).nullable(),
          extra: z.array(z.object({ column: z.number().int().min(0), field: z.string().trim().min(1).max(40) })).max(30)
        }),
        tags: z.array(tag).max(10)
      })
      .strict(),
    (a) => people.runImport(a.accountId, a.token, a.mapping, a.tags)
  )
  handle('people:export', z.object({ accountId }).strict(), (a) =>
    saveCsv(getWindow(), `contatos-${stamp()}.csv`, people.exportCsv(a.accountId))
  )

  // ---------- Campanhas e anti-bloqueio ----------
  handle('antiban:get', z.object({ accountId }).strict(), (a) => C.getAntiBan(a.accountId))
  handle(
    'antiban:set',
    z
      .object({
        accountId,
        patch: z
          .object({
            minDelay: z.number().int().min(10).max(3600),
            maxDelay: z.number().int().min(10).max(7200),
            pauseEvery: z.number().int().min(0).max(500),
            pauseMin: z.number().int().min(1).max(240),
            pauseMax: z.number().int().min(1).max(480),
            dailyLimit: z.number().int().min(1).max(2000),
            hourStart: z.number().int().min(0).max(23),
            hourEnd: z.number().int().min(1).max(24),
            days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
            typing: z.boolean(),
            warmup: z.boolean(),
            minReplyRate: z.number().min(0).max(100),
            maxFailStreak: z.number().int().min(1).max(50)
          })
          .partial()
          .strict()
      })
      .strict(),
    (a) => {
      const r = C.setAntiBan(a.accountId, a.patch)
      engine.kick(a.accountId)
      return r
    }
  )
  handle('campaigns:list', z.object({ accountId }).strict(), (a) => C.listCampaigns(a.accountId))
  handle('campaigns:get', z.object({ id }).strict(), (a) => campaignOf(a.id))
  handle(
    'campaigns:save',
    z
      .object({
        id: id.optional(),
        accountId,
        name: z.string().trim().min(1, 'Dê um nome à campanha').max(100),
        templates: z.array(z.string().max(4096)).min(1).max(10),
        audience,
        optOutFooter: z.boolean(),
        scheduledAt: z.number().int().positive().nullable()
      })
      .strict(),
    (a) => {
      need(a.accountId, a.audience.type === 'groups' ? 'gruposEnvio' : 'campanhas')
      return C.saveCampaign(a)
    }
  )
  handle(
    'campaigns:media',
    z
      .object({ id, file: z.object({ name: z.string().max(255), mime: z.string().max(120), data: bytes }).nullable() })
      .strict(),
    (a) => C.setCampaignMedia(a.id, a.file)
  )
  handle('campaigns:audience-count', z.object({ accountId, audience }).strict(), (a) =>
    a.audience.type === 'groups'
      ? { total: a.audience.groups?.length ?? 0, optedOut: 0 }
      : C.countAudience(a.accountId, a.audience)
  )
  handle('campaigns:start', z.object({ id }).strict(), (a) => {
    const c = campaignOf(a.id)
    need(c.accountId, c.kind === 'groups' ? 'gruposEnvio' : 'campanhas', 'lembretes')
    const r = C.startCampaign(a.id)
    engine.kick(c.accountId)
    return r
  })
  handle('campaigns:pause', z.object({ id }).strict(), (a) => {
    C.pauseCampaign(a.id, null)
    engine.kick(campaignOf(a.id).accountId)
    return campaignOf(a.id)
  })
  handle('campaigns:cancel', z.object({ id }).strict(), (a) => {
    C.cancelCampaign(a.id)
    engine.kick(campaignOf(a.id).accountId)
    return campaignOf(a.id)
  })
  handle('campaigns:retry', z.object({ id }).strict(), (a) => C.retryFailed(a.id))
  handle('campaigns:delete', z.object({ id }).strict(), (a) => C.deleteCampaign(a.id))
  handle('campaigns:duplicate', z.object({ id }).strict(), (a) => {
    const c = campaignOf(a.id)
    return C.saveCampaign({
      accountId: c.accountId,
      name: `${c.name} (cópia)`,
      templates: c.templates,
      audience: c.audience,
      optOutFooter: c.optOutFooter,
      scheduledAt: null
    })
  })
  handle(
    'campaigns:targets',
    z
      .object({
        id,
        status: z.enum(['all', 'pending', 'sent', 'failed', 'skipped', 'no_wa', 'opted_out']),
        limit: z.number().int().min(1).max(500),
        offset: z.number().int().min(0)
      })
      .strict(),
    (a) => C.listTargets(a.id, a.status, a.limit, a.offset)
  )
  handle('campaigns:export', z.object({ id }).strict(), (a) =>
    saveCsv(getWindow(), `campanha-${a.id}-${stamp()}.csv`, C.exportReport(a.id))
  )
  // Teste: envia as variações para o próprio número
  handle(
    'campaigns:test',
    z
      .object({ accountId, templates: z.array(z.string().max(4096)).min(1).max(10), optOutFooter: z.boolean() })
      .strict(),
    async (a) => {
      const s = sock(a.accountId)
      const me = s.user?.id ? `${s.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net` : null
      if (!me) throw new Error('Número da conta desconhecido')
      const account = getAccount(a.accountId)
      for (const t of a.templates.filter((x) => x.trim())) {
        let text = renderTemplate(t, {
          nome: 'Maria da Silva',
          primeiro_nome: firstName('Maria da Silva'),
          loja: account?.name ?? ''
        })
        if (a.optOutFooter) text += `\n\n_${OPT_OUT_FOOTER}_`
        await sendAndStore(s, a.accountId, me, { text: `[TESTE]\n${text}` })
      }
    }
  )
  handle('engine:state', z.object({ accountId }).strict(), (a) => engine.state(a.accountId))

  // ---------- Respostas automáticas ----------
  const ruleSchema = z
    .object({
      id: id.optional(),
      name: z.string().trim().min(1).max(80),
      kind: z.enum(['keyword', 'away', 'welcome']),
      enabled: z.boolean(),
      keywords: z.array(z.string().max(60)).max(50),
      matchMode: z.enum(['contains', 'exact', 'starts']),
      reply: z.string().max(4096),
      cooldownMin: z.number().int().min(1).max(10_080),
      schedule: z
        .object({
          hourStart: z.number().int().min(0).max(23),
          hourEnd: z.number().int().min(1).max(24),
          days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
        })
        .optional()
    })
    .strict()
  handle('rules:list', z.object({ accountId }).strict(), (a) => rules.listRules(a.accountId))
  handle('rules:save', z.object({ accountId, rule: ruleSchema }).strict(), (a) => {
    need(a.accountId, 'respostasAuto')
    return rules.saveRule(a.accountId, a.rule)
  })
  handle('rules:delete', z.object({ accountId, id }).strict(), (a) => rules.deleteRule(a.accountId, a.id))

  // ---------- Grupos ----------
  handle('groups:list', z.object({ accountId, refresh: z.boolean().optional() }).strict(), async (a) => {
    need(a.accountId, 'gruposEnvio', 'gruposExtrair', 'gruposCriar', 'gruposModeracao')
    const cached = groups.listGroups(a.accountId)
    if (a.refresh || !cached.length) {
      const s = wa.getSocket(a.accountId)
      if (s) return groups.refreshGroups(s, a.accountId)
    }
    return cached
  })
  handle('groups:extract', z.object({ accountId, jids: z.array(groupJid).min(1).max(500) }).strict(), (a) => {
    need(a.accountId, 'gruposExtrair')
    return groups.extractMembers(a.accountId, a.jids)
  })
  handle(
    'groups:create',
    z
      .object({
        accountId,
        subject: z.string().trim().min(1).max(100),
        description: z.string().max(2000).optional(),
        phones: z.array(z.string().max(30)).max(1024).optional(),
        tag: tag.optional(),
        adminsOnly: z.boolean().optional()
      })
      .strict(),
    async (a) => {
      need(a.accountId, 'gruposCriar')
      let phones = a.phones ?? []
      if (a.tag) {
        const { items } = people.listPeople({
          accountId: a.accountId,
          tag: a.tag,
          optOut: 'exclude',
          limit: 1024,
          offset: 0
        })
        phones = [...phones, ...items.map((p) => p.phone)]
      }
      return groups.createGroup(sock(a.accountId), a.accountId, {
        subject: a.subject,
        description: a.description,
        phones,
        adminsOnly: a.adminsOnly
      })
    }
  )
  handle('groups:invite', z.object({ accountId, jid: groupJid }).strict(), (a) =>
    groups.groupInviteLink(sock(a.accountId), a.jid)
  )
  handle('groups:rule-get', z.object({ accountId, jid: groupJid }).strict(), (a) =>
    groups.getGroupRule(a.accountId, a.jid)
  )
  handle(
    'groups:rule-save',
    z
      .object({
        accountId,
        jid: groupJid,
        rule: z
          .object({
            welcome: z.string().max(2000).nullable(),
            antiLink: z.boolean(),
            bannedWords: z.array(z.string().max(60)).max(200),
            maxWarnings: z.number().int().min(0).max(10)
          })
          .strict()
      })
      .strict(),
    (a) => {
      need(a.accountId, 'gruposModeracao')
      return groups.saveGroupRule(a.accountId, a.jid, a.rule)
    }
  )

  // ---------- Lembretes ----------
  handle('reminders:list', z.object({ accountId }).strict(), (a) => reminders.listReminders(a.accountId))
  handle(
    'reminders:save',
    z
      .object({
        accountId,
        reminder: z
          .object({
            id: id.optional(),
            name: z.string().trim().min(1).max(80),
            kind: z.enum(['birthday', 'days_after', 'yearly']),
            field: z.string().max(40).nullable(),
            offsetDays: z.number().int().min(-365).max(3650),
            sendHour: z.number().int().min(0).max(23),
            template: z.string().max(4096),
            tags: z.array(tag).max(20),
            enabled: z.boolean()
          })
          .strict()
      })
      .strict(),
    (a) => {
      need(a.accountId, 'lembretes')
      return reminders.saveReminder(a.accountId, a.reminder)
    }
  )
  handle('reminders:delete', z.object({ accountId, id }).strict(), (a) => reminders.deleteReminder(a.accountId, a.id))
  handle('reminders:preview', z.object({ accountId, id }).strict(), (a) => {
    const r = reminders.listReminders(a.accountId).find((x) => x.id === a.id)
    if (!r) throw new Error('Lembrete não encontrado')
    return reminders.dueToday(a.accountId, r).length
  })

  // ---------- Vendas ----------
  handle(
    'deals:save',
    z
      .object({
        accountId,
        chatJid: jid,
        status: z.enum(['won', 'lost']),
        amountCents: z.number().int().min(0).max(100_000_000_00),
        product: z.string().max(200).optional(),
        payment: z.string().max(60).optional(),
        reason: z.string().max(80).optional(),
        note: z.string().max(1000).optional()
      })
      .strict(),
    (a) => {
      need(a.accountId, 'vendas')
      return deals.saveDeal(a.accountId, a)
    }
  )
  handle(
    'deals:list',
    z
      .object({
        accountId,
        chatJid: jid.optional(),
        from: z.number().int().optional(),
        to: z.number().int().optional()
      })
      .strict(),
    (a) => deals.listDeals(a.accountId, a)
  )
  handle('deals:delete', z.object({ accountId, id }).strict(), (a) => deals.deleteDeal(a.accountId, a.id))
  handle('deals:summary', z.object({ accountId, from: z.number().int(), to: z.number().int() }).strict(), (a) =>
    deals.salesSummary(a.accountId, a.from, a.to)
  )

  // ---------- IA ----------
  handle('ai:providers', null, () => ai.listProviders())
  handle(
    'ai:provider-save',
    z
      .object({
        id: id.optional(),
        preset: z.enum(['groq', 'gemini', 'openrouter', 'mistral', 'ollama', 'claude', 'custom']),
        name: z.string().max(60).optional(),
        baseUrl: z.string().max(300).optional(),
        apiKey: z.string().max(400).nullable().optional(),
        modelFast: z.string().max(120).optional(),
        modelSmart: z.string().max(120).optional(),
        trainsOnData: z.boolean().optional(),
        enabled: z.boolean().optional(),
        priority: z.number().int().min(0).max(1000).optional()
      })
      .strict(),
    (a) => ai.saveProvider(a)
  )
  handle('ai:provider-delete', z.object({ id }).strict(), (a) => ai.deleteProvider(a.id))
  handle('ai:provider-test', z.object({ id }).strict(), (a) => ai.testProvider(a.id))
  handle('ai:settings', null, () => ai.getAiSettings())
  handle(
    'ai:settings-save',
    z
      .object({
        privacy: z.enum(['estrita', 'anonimizar', 'livre']).optional(),
        paidMonthlyLimit: z.number().int().min(0).max(100_000).optional()
      })
      .strict(),
    (a) => ai.setAiSettings(a)
  )
  handle('ai:log', null, () => ai.recentAiLog())
  handle('ai:suggest', z.object({ accountId, jid, goal: z.string().max(300).optional() }).strict(), (a) => {
    need(a.accountId, 'ia')
    return assistant.suggestReply(a.accountId, a.jid, a.goal)
  })
  handle(
    'ai:variations',
    z
      .object({
        accountId,
        base: z.string().max(4096),
        count: z.number().int().min(1).max(8),
        brief: z.string().max(1000).optional()
      })
      .strict(),
    (a) => {
      need(a.accountId, 'ia')
      return assistant.campaignVariations(a.accountId, a.base, a.count, a.brief)
    }
  )
  handle('ai:playbook', z.object({ accountId }).strict(), (a) => assistant.getPlaybook(a.accountId))
  handle('ai:playbook-build', z.object({ accountId }).strict(), (a) => {
    need(a.accountId, 'ia')
    const win = getWindow()
    return assistant.buildPlaybook(a.accountId, (done, total) =>
      win?.webContents.send('ai:progress', { accountId: a.accountId, done, total })
    )
  })
  handle('ai:playbook-save', z.object({ accountId, content: z.string().max(50_000) }).strict(), (a) =>
    assistant.savePlaybook(a.accountId, a.content)
  )
}
