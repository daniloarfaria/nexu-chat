// Anonimização do texto que vai para a IA (função pura).

/**
 * Troca dados pessoais por marcadores antes de enviar à IA:
 * telefones, e-mails, CPF/CNPJ, CEP, cartões, links e os nomes conhecidos.
 * Função pura para teste.
 */
export function anonymize(text: string, names: string[] = []): string {
  let t = text
    .slice(0, 20_000)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[link]')
    // Receita de óculos (dado de saúde): grau esférico/cilíndrico, eixo, adição, DNP
    .replace(
      /\b(OD|OE|AO|esf(?:érico|erico)?|cil(?:índrico|indrico)?|eixo|adi[cç][aã]o|DNP|DP)\b\s*[:=]?\s*[+-]?\d{1,3}(?:[.,]\d{1,2})?°?/gi,
      '[receita]'
    )
    .replace(/(?<![\w.,])[+-]\d{1,2}[.,]\d{2}\b/g, '[grau]')
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/g, '[cpf]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX]\b/g, '[rg]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[cartao]')
    .replace(/\b\d{5}-?\d{3}\b/g, '[cep]')
    // Telefones em qualquer formato: +55 (11) 9 8765-4321, 11.98765.4321, 98765 4321…
    .replace(/\+?\d[\d ().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[telefone]' : m))
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[data]')
    // Endereço: "Rua X, 123", "Av. Paulista 1000", "Alameda…"
    .replace(
      /\b(rua|r\.|av(?:enida)?\.?|alameda|al\.|travessa|tv\.|rodovia|estrada|pra[cç]a)\s+[^,\n]{2,50}?,?\s*(n[ºo°.]?\s*)?\d{1,5}\b/gi,
      '[endereco]'
    )
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2 && !/^\+?\d/.test(n)))]
  // Nome completo e cada parte (≥ 2 letras, exceto preposições) viram [cliente]
  const stop = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])
  const parts = [
    ...new Set(clean.flatMap((n) => [n, ...n.split(/\s+/).filter((p) => p.length >= 2 && !stop.has(p.toLowerCase()))]))
  ].sort((a, b) => b.length - a.length)
  for (const p of parts) {
    t = t.replace(
      new RegExp(`(?<![\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'),
      '[cliente]'
    )
  }
  return t
}
