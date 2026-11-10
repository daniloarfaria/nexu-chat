/**
 * Referência do endpoint de leads do Nexu Chat.
 * Integre o doPost ao roteador do formulário existente: pedidos de leads têm
 * operacao: 'leads'; os demais devem continuar no manipulador do formulário.
 * Configure SEGREDO_INTEGRACAO_LEADS com senha própria, longa e aleatória,
 * diferente de SEGREDO_FORMULARIO. Preserve ABAS do modelo do cliente.
 * doGet existe só para compatibilidade: segredo na URL pode ficar em logs e históricos.
 * Prefira POST com JSON { operacao: 'leads', segredo, desde, offset }.
 * Publique uma nova versão da implantação após atualizar.
 */
const MAX_LINHAS = 2000;

// No modelo da agência o doPost do formulário já existe: NÃO duplique. Coloque no começo dele:
//   if (corpo.operacao === 'leads') return buscarLeads_(corpo);
// (o doPost abaixo é só a referência isolada).
function doPost(e) {
  let params;
  try { params = JSON.parse(e.postData.contents); }
  catch (_) { return responderLeads_({ ok: false, erro: 'Não autorizado' }); }
  return buscarLeads_(params);
}

function doGet(e) {
  return buscarLeads_((e && e.parameter) || {});
}

function buscarLeads_(params) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  let autorizado = false;
  try {
    const falhas = Number(cache.get('leads:falhas') || 0);
    const segredo = PropertiesService.getScriptProperties().getProperty('SEGREDO_INTEGRACAO_LEADS');
    autorizado = falhas < 20 && !!segredo && params.segredo === segredo;
    if (!autorizado) cache.put('leads:falhas', String(Math.min(falhas + 1, 20)), 300);
  } finally { lock.releaseLock(); }
  if (!autorizado) return responderLeads_({ ok: false, erro: 'Não autorizado' });

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
      if (ts <= desde || ts > Date.now() + 86400000) return;
      const lead = { aba: config.nome, ts: ts };
      config.campos.forEach(function (campo, i) {
        lead[campo] = String(linha[i + 1] == null ? '' : linha[i + 1]);
      });
      leads.push(lead);
    });
  });

  leads.sort(function (a, b) { return a.ts - b.ts; });
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  return responderLeads_({ ok: true, leads: leads.slice(offset, offset + MAX_LINHAS) });
}

function responderLeads_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
