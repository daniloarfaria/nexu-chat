import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { AnyMessageContent, WASocket } from 'baileys'
import type { Campaign, EngineState } from '@shared/types'
import * as C from './campaigns'
import { effectiveDailyLimit, OPT_OUT_FOOTER, randomBetween, renderTemplate, sendWindow } from '@shared/rules'
import { isOptedOut, markHasWa } from './people'
import { wa } from './wa/manager'
import { sendAndStore } from './wa/send'
import { canonJid } from './wa/store'
import { listAccounts } from './accounts'
import { log } from './log'

/**
 * Motor de campanhas: uma fila por conta, um envio por vez, com todas as regras
 * de proteção contra bloqueio. O estado fica no banco, então sobrevive a reinícios.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Runner {
  timer: NodeJS.Timeout | null
  busy: boolean
  sinceLongPause: number
  failStreak: number
  failCampaign: number | null
  notBefore: number
  state: EngineState
}

class CampaignEngine extends EventEmitter {
  private runners = new Map<string, Runner>()

  private runner(accountId: string): Runner {
    let r = this.runners.get(accountId)
    if (!r) {
      r = {
        timer: null,
        busy: false,
        sinceLongPause: 0,
        failStreak: 0,
        failCampaign: null,
        notBefore: 0,
        state: { accountId, campaignId: null, phase: 'idle', nextAt: null, sentToday: 0, limitToday: 0 }
      }
      this.runners.set(accountId, r)
    }
    return r
  }

  state(accountId: string): EngineState {
    const r = this.runner(accountId)
    const s = C.getAntiBan(accountId)
    return { ...r.state, sentToday: C.sentToday(accountId), limitToday: effectiveDailyLimit(s) }
  }

  private set(accountId: string, patch: Partial<EngineState>): void {
    const r = this.runner(accountId)
    r.state = { ...r.state, ...patch }
    this.emit('state', this.state(accountId))
  }

  private changed(campaignId: number): void {
    const c = C.getCampaign(campaignId)
    if (c) this.emit('campaign', c)
  }

  /** Agenda o próximo passo da conta. */
  private schedule(accountId: string, ms: number, safety = false): void {
    const r = this.runner(accountId)
    if (safety) r.notBefore = Date.now() + ms
    // Nada (iniciar outra campanha, salvar proteção…) encurta um intervalo de segurança em andamento
    const wait = Math.max(ms, r.notBefore - Date.now(), 0)
    if (r.timer) clearTimeout(r.timer)
    r.timer = setTimeout(() => void this.tick(accountId), wait)
  }

  kick(accountId: string): void {
    this.schedule(accountId, 300)
  }

  startAll(): void {
    for (const a of listAccounts()) this.kick(a.id)
    // Verificação periódica (agendadas, janela de horário, reconexões)
    setInterval(() => {
      for (const a of listAccounts()) {
        const r = this.runner(a.id)
        if (!r.timer && !r.busy) this.kick(a.id)
      }
    }, 60_000)
  }

  stop(accountId: string): void {
    const r = this.runner(accountId)
    if (r.timer) clearTimeout(r.timer)
    r.timer = null
  }

  private async tick(accountId: string): Promise<void> {
    const r = this.runner(accountId)
    r.timer = null
    if (r.busy) return
    r.busy = true
    try {
      await this.step(accountId, r)
    } catch (e) {
      log.error('Erro no motor de campanhas', e)
      this.schedule(accountId, 30_000)
    } finally {
      r.busy = false
    }
  }

  private async step(accountId: string, r: Runner): Promise<void> {
    C.promoteScheduled(accountId)
    const campaign = C.nextRunning(accountId)
    if (!campaign) {
      this.set(accountId, { phase: 'idle', campaignId: null, nextAt: null, message: undefined })
      return // o intervalo de 60 s verifica agendadas
    }
    const sock = wa.getSocket(accountId)
    if (!sock) {
      this.set(accountId, { phase: 'disconnected', campaignId: campaign.id, nextAt: Date.now() + 30_000 })
      return this.schedule(accountId, 30_000)
    }
    const s = C.getAntiBan(accountId)

    const win = sendWindow(s)
    if (!win.open) {
      this.set(accountId, { phase: 'outside_hours', campaignId: campaign.id, nextAt: win.opensAt })
      return this.schedule(accountId, Math.min(15 * 60_000, (win.opensAt ?? Date.now() + 3600_000) - Date.now()))
    }
    const limit = effectiveDailyLimit(s)
    if (C.sentToday(accountId) >= limit) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(s.hourStart, 0, 0, 0)
      this.set(accountId, { phase: 'daily_limit', campaignId: campaign.id, nextAt: tomorrow.getTime() })
      return this.schedule(accountId, 15 * 60_000)
    }
    if (s.pauseEvery > 0 && r.sinceLongPause >= s.pauseEvery) {
      r.sinceLongPause = 0
      const ms = randomBetween(s.pauseMin, s.pauseMax) * 60_000
      this.set(accountId, { phase: 'paused_long', campaignId: campaign.id, nextAt: Date.now() + ms })
      return this.schedule(accountId, ms, true)
    }

    // Saúde: taxa de resposta muito baixa → pausa para proteger o número.
    // Conta só envios com mais de 2 h (tempo para o cliente responder).
    const st = C.replyHealth(campaign.id, 2 * 3600_000)
    if (s.minReplyRate > 0 && st.sent >= 30 && (st.replied / st.sent) * 100 < s.minReplyRate) {
      C.pauseCampaign(
        campaign.id,
        `Pausada para proteger o número: só ${Math.round((st.replied / st.sent) * 100)}% responderam (mínimo configurado: ${s.minReplyRate}%).`
      )
      this.changed(campaign.id)
      return this.kick(accountId)
    }

    const target = C.nextTarget(campaign.id)
    if (!target) {
      C.finishCampaign(campaign.id)
      this.changed(campaign.id)
      this.set(accountId, { phase: 'idle', campaignId: null, nextAt: null })
      return this.kick(accountId)
    }

    if (r.failCampaign !== campaign.id) {
      r.failCampaign = campaign.id
      r.failStreak = 0
    }
    const result = await this.sendOne(sock, accountId, campaign, target, s.typing)
    this.changed(campaign.id)

    if (result === 'skip') return this.schedule(accountId, randomBetween(1500, 4000)) // sem envio real: segue rápido
    if (result === 'fail') {
      r.failStreak++
      if (r.failStreak >= s.maxFailStreak) {
        C.pauseCampaign(
          campaign.id,
          `Pausada após ${r.failStreak} falhas seguidas. Verifique a conexão do WhatsApp e retome.`
        )
        r.failStreak = 0
        this.changed(campaign.id)
        return this.kick(accountId)
      }
    } else {
      r.failStreak = 0
      r.sinceLongPause++
      C.countSend(accountId)
    }
    const delay = randomBetween(s.minDelay, s.maxDelay) * 1000
    this.set(accountId, { phase: 'waiting', campaignId: campaign.id, nextAt: Date.now() + delay })
    this.schedule(accountId, delay, true)
  }

  private async sendOne(
    sock: WASocket,
    accountId: string,
    c: Campaign,
    t: C.PendingTarget,
    typing: boolean
  ): Promise<'sent' | 'fail' | 'skip'> {
    this.set(accountId, { phase: 'sending', campaignId: c.id, nextAt: null })
    let jid = t.jid
    try {
      // Pessoas: confere opt-out na hora e se o número tem WhatsApp
      if (c.kind !== 'groups') {
        if (t.person_id && jid && isOptedOut(accountId, jid)) {
          C.markTarget(c.id, t.seq, 'opted_out')
          return 'skip'
        }
        if (!jid && t.phone && isOptedOut(accountId, t.phone)) {
          C.markTarget(c.id, t.seq, 'opted_out')
          return 'skip'
        }
        if (!jid) {
          const [res] = (await sock.onWhatsApp(t.phone ?? '')) ?? []
          if (!res?.exists) {
            C.markTarget(c.id, t.seq, 'no_wa')
            if (t.person_id) markHasWa(t.person_id, null, false)
            return 'skip'
          }
          jid = canonJid(accountId, res.jid)
          if (t.person_id) markHasWa(t.person_id, jid, true)
          if (isOptedOut(accountId, jid)) {
            C.markTarget(c.id, t.seq, 'opted_out', { jid })
            return 'skip'
          }
        }
      }
      const vars = t.vars ? (JSON.parse(t.vars) as Record<string, string>) : {}
      const tpl = c.templates[Math.floor(Math.random() * c.templates.length)]
      let text = renderTemplate(tpl, vars)
      if (c.optOutFooter && c.kind !== 'groups') text += `\n\n_${OPT_OUT_FOOTER}_`

      if (typing) {
        await sock.presenceSubscribe(jid!).catch(() => undefined)
        await sock.sendPresenceUpdate('composing', jid!).catch(() => undefined)
        await sleep(Math.min(8000, 1500 + text.length * 35) * randomBetween(0.7, 1.2))
        await sock.sendPresenceUpdate('paused', jid!).catch(() => undefined)
      }
      // Pausada/cancelada ou pediu SAIR enquanto "digitava": não envia
      if (C.getCampaign(c.id)?.status !== 'running') return 'skip'
      if (c.kind !== 'groups' && (isOptedOut(accountId, jid!) || (t.phone && isOptedOut(accountId, t.phone)))) {
        C.markTarget(c.id, t.seq, 'opted_out', { jid: jid! })
        return 'skip'
      }
      if (!C.targetStillPending(c.id, t.seq)) return 'skip' // contato excluído ou alvo alterado

      let content: AnyMessageContent
      if (c.media) {
        const data = readFileSync(C.mediaPath(c.media))
        const mime = c.media.mime
        if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) content = { image: data, caption: text, mimetype: mime }
        else if (/^video\//.test(mime)) content = { video: data, caption: text, mimetype: 'video/mp4' }
        else if (/^audio\//.test(mime)) content = { audio: data, mimetype: mime }
        else content = { document: data, mimetype: mime, fileName: c.media.name, caption: text }
      } else {
        content = { text }
      }
      const sent = await sendAndStore(sock, accountId, jid!, content)
      // Áudio não tem legenda: manda o texto em seguida
      // O principal já foi: marca como enviado antes do complemento, para nunca reenviar em dobro
      C.markTarget(c.id, t.seq, 'sent', { messageId: sent?.key.id ?? undefined, jid: jid! })
      if (c.media && /^audio\//.test(c.media.mime) && text) {
        await sendAndStore(sock, accountId, jid!, { text }).catch((e: Error) =>
          log.warn('Texto após o áudio não foi enviado', { erro: e.message })
        )
      }
      return 'sent'
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      C.markTarget(c.id, t.seq, 'failed', { error: msg.slice(0, 300), jid: jid ?? undefined })
      log.warn('Falha no envio de campanha', { campanha: c.id, erro: msg })
      return 'fail'
    }
  }
}

export const engine = new CampaignEngine()
