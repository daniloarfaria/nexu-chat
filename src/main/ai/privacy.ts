// Preparação do texto de clientes para a IA na nuvem (função pura).
import { isSensitive } from '@shared/sensitive'

export const OMITTED = '[trecho omitido: dado sensível]'

/**
 * Troca por um aviso cada linha que fala de saúde, religião, política etc. (LGPD).
 * Vale para notas, conversa e instrução do atendente; só é usada quando o pedido vai para a nuvem.
 */
export function dropSensitiveLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (isSensitive(line) ? OMITTED : line))
    .join('\n')
}
