import { cpus, freemem, totalmem } from 'node:os'
import { statfsSync } from 'node:fs'
import type { AiRecommendation, HardwareInfo } from '@shared/types'
import { engineAssetFor, lightModel, mediumModel } from './catalog'

const GB = 1024 ** 3
const round = (n: number): number => Math.round(n * 10) / 10

/** Memória, processador e espaço livre no disco onde ficam os dados do app. */
export function detectHardware(dataDir: string): HardwareInfo {
  let freeDiskGb: number | null = null
  try {
    const s = statfsSync(dataDir)
    freeDiskGb = round((s.bavail * s.bsize) / GB)
  } catch {
    /* sem informação de disco: a tela avisa */
  }
  const list = cpus()
  return {
    platform: process.platform,
    arch: process.arch,
    totalMemGb: round(totalmem() / GB),
    freeMemGb: round(freemem() / GB),
    cpus: list.length,
    cpuModel: list[0]?.model?.trim() ?? '',
    freeDiskGb
  }
}

/** Memória mínima para recomendar a IA no computador (modelo leve usa até ~1,2 GB). */
export const MIN_RAM_LOCAL_GB = 6
/** Memória mínima para oferecer o modelo médio (opcional, a loja liga). */
export const MIN_RAM_MEDIUM_GB = 16

const needGb = (bytes: number): number => bytes / GB + 0.5 // folga para o motor e arquivos temporários

/** Recomendação a partir do computador (função pura para teste). */
export function recommend(hw: HardwareInfo): AiRecommendation {
  const reasons: string[] = []
  const supported = !!engineAssetFor(hw.platform, hw.arch)
  if (!supported) reasons.push('Este sistema ainda não tem a IA no computador. Use a IA gratuita na nuvem.')
  const disk = hw.freeDiskGb
  const diskOk = disk == null || disk >= needGb(lightModel().size)
  if (supported && !diskOk) reasons.push(`Pouco espaço livre no disco (${disk} GB). A IA no computador precisa de 1,5 GB.`)
  const memOk = hw.totalMemGb >= MIN_RAM_LOCAL_GB - 0.5 // "8 GB" às vezes aparece como 7,9
  if (supported && !memOk)
    reasons.push(`O computador tem ${hw.totalMemGb} GB de memória. Com menos de ${MIN_RAM_LOCAL_GB} GB a IA local deixa tudo lento.`)
  const localRecommended = supported && diskOk && memOk
  const offerMedium =
    localRecommended &&
    hw.totalMemGb >= MIN_RAM_MEDIUM_GB - 0.5 &&
    (disk == null || disk >= needGb(lightModel().size + mediumModel().size))
  if (localRecommended)
    reasons.push(
      offerMedium
        ? 'Memória de sobra: dá para usar a IA leve no computador e, se quiser, ligar o modelo médio.'
        : 'Dá para usar a IA leve no computador. As tarefas maiores vão para a nuvem gratuita.'
    )
  const slowWarning = localRecommended && (hw.cpus < 4 || hw.totalMemGb < 8 - 0.5)
  return {
    localSupported: supported,
    localRecommended,
    offerMedium,
    primary: localRecommended ? 'ambas' : 'nuvem',
    reasons,
    slowWarning
  }
}

/** Metade dos núcleos, para o computador da loja não travar. */
export function engineThreads(cpuCount = cpus().length): number {
  return Math.max(1, Math.floor(cpuCount / 2))
}
