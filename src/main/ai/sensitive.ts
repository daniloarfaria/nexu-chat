import { fold } from '@shared/rules'

/**
 * Dado sensível pela LGPD (saúde, religião, política, vida íntima, sindicato):
 * não vira nota, não é salvo à mão e não vai para a IA na nuvem.
 * Comparação sem acento e sem maiúsculas.
 */
const HEALTH =
  /\b(grau|graus|dioptria\w*|miopia|miope|astigmatismo|hipermetropia|presbiopia|vista cansada|problemas? de vista|problemas? na vista|enxerga mal|catarata|glaucoma|ceratocone|receita medica|oftalmo\w*|diagnostic\w*|doenca\w*|diabet\w*|pressao alta|hipertens\w*|cancer|remedio\w*|medicament\w*|cirurgi\w*|laudo|exame\w*|deficien\w*|gravida\w*|gestante|depress\w*|ansiedade|psiquiatr\w*|hiv|cego|cega|surdo|surda|obeso|obesa|tdah|autis\w*|cadeirante|lentes? de contato|saude|esf|cil|eixo|adicao)\b/

const SENSITIVE_OTHER =
  /\b(religi\w*|evangelic\w*|catolic\w*|espirita|umbanda|candomble|ateu|ateia|igreja|pastor|padre|deus|fe|crente|cristao|crista|judeu|judia|muculmano|muculmana|budista|sindicat\w*|partido|politic\w*|bolsonar\w*|lula|homossexual|gay|lesbica|orientacao sexual|etnia|raca)\b/

/** Valor de grau com sinal (-2,50 / +1.25), mesmo sem a palavra "grau". */
const DEGREE = /(?<![\w.,])[+-]\d{1,2}[.,]\d{2}\b/

export function isSensitive(text: string): boolean {
  const t = fold(text)
  return HEALTH.test(t) || SENSITIVE_OTHER.test(t) || DEGREE.test(text)
}
