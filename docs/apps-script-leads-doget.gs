/**
 * REFERÊNCIA: novo doGet do Codigo.gs (modelo Apps Script da agência) para o Nexu Chat buscar os leads.
 *
 * Como usar: no Codigo.gs do cliente, SUBSTITUA a função doGet() antiga por este bloco
 * (as constantes ABAS e PROPRIEDADE_SEGREDO já existem no modelo; não duplique) e
 * publique uma nova versão da implantação (Implantar → Gerenciar implantações → Editar → Nova versão).
 *
 * Segurança (LGPD):
 *  - Exige a mesma senha do formulário (propriedade do script SEGREDO_FORMULARIO), enviada no parâmetro "segredo".
 *  - Sem a senha certa, não devolve nenhum lead. Nada fica público; NÃO publique a planilha como CSV.
 *  - Só devolve linhas mais novas que "desde" (milissegundos desde 1970), no máximo MAX_LINHAS por chamada.
 *
 * Resposta: { ok: true, leads: [ { aba, ts, nome, email, telefone, interesse, mensagem,
 *             utm_source, utm_medium, utm_campaign, utm_content, utm_term, pagina } ] }
 *   ou { ok: false, erro: '...' }
 */
const MAX_LINHAS = 2000;

function doGet(e) {
  const params = (e && e.parameter) || {};

  // Abrir o link no navegador, sem senha, só mostra que o script está no ar (nenhum dado).
  if (!params.segredo) {
    return ContentService.createTextOutput('Formulário: ativo.');
  }

  const segredo = PropertiesService.getScriptProperties().getProperty(PROPRIEDADE_SEGREDO);
  if (!segredo) return responderLeads_({ ok: false, erro: 'Senha do formulário não configurada no Apps Script.' });
  if (params.segredo !== segredo) return responderLeads_({ ok: false, erro: 'Não autorizado.' });

  const desde = Number(params.desde) > 0 ? Number(params.desde) : 0;
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const leads = [];

  Object.keys(ABAS).forEach(function (tipo) {
    const config = ABAS[tipo];
    const aba = planilha.getSheetByName(config.nome);
    if (!aba || aba.getLastRow() < 2) return;
    const valores = aba.getRange(2, 1, aba.getLastRow() - 1, config.colunas.length).getValues();
    valores.forEach(function (linha) {
      const data = linha[0];
      if (!(data instanceof Date)) return; // linha sem data válida (editada à mão): ignora
      const ts = data.getTime();
      if (ts <= desde) return;
      const lead = { aba: config.nome, ts: ts };
      config.campos.forEach(function (campo, i) {
        lead[campo] = String(linha[i + 1] == null ? '' : linha[i + 1]);
      });
      leads.push(lead);
    });
  });

  leads.sort(function (a, b) { return a.ts - b.ts; });
  return responderLeads_({ ok: true, leads: leads.slice(0, MAX_LINHAS) });
}

function responderLeads_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
