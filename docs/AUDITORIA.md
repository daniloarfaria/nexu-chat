# Auditoria de segurança e bugs: fase 9

> Data: 05/11/2026 · Versão auditada: 0.3.1 → corrigida na 0.4.0
> Escopo: revisão estática do código-fonte do app (processo principal, ponte IPC, interface, banco local, integração com WhatsApp e IA), dependências e configuração de empacotamento. Não houve teste ativo contra serviços de terceiros.
> Método: três revisões independentes (Electron/IPC, dados/criptografia/LGPD, bugs de lógica). Cada achado foi conferido no código antes de corrigir, e os testes automáticos foram ampliados (de 84 para 91).

## Resumo

| | Encontrados | Corrigidos | Pendentes |
|---|---|---|---|
| Crítico | 0 | 0 | 0 |
| Alto | 8 | 8 | 0 |
| Médio | 16 | 15 | 1 (assinatura do instalador de Windows) |
| Baixo | 12 | 9 | 3 (aceitos, abaixo) |

Dependências que vão no app: **0 vulnerabilidades** (`npm audit --omit=dev`). Uma vulnerabilidade moderada no `minimatch` afeta só a ferramenta de gerar instaladores, que não vai para o app. O zod foi atualizado da 3 para a 4 para corrigir uma vulnerabilidade alta.

## Corrigido

### Segurança e privacidade
1. **Endereço do provedor de IA** (alto): `http://localhost.atacante.com` passava na validação. Agora o endereço é lido pela estrutura da URL: só https, com http aceito apenas para `localhost`, `127.0.0.1` e `[::1]`, e sem usuário ou senha na URL.
2. **Chave de API ao trocar o endereço** (alto): a chave salva continuava sendo enviada para o novo servidor. Agora, se o servidor mudar, a chave é apagada e precisa ser informada de novo.
3. **Exclusão de contato (LGPD)** (alto): só a ficha era apagada. Agora a exclusão apaga também as conversas, mensagens, índice de busca, mídias, vendas, registros de respostas automáticas e avisos de grupo, e anonimiza o histórico de envios de campanha.
4. **Lista de supressão** (alto): quem pediu SAIR voltava a receber se fosse excluído e reimportado. Também não ficava gravado quem mandava SAIR por um identificador LID sem número, embora o app confirmasse. Agora existe a tabela `suppression`, que guarda número, JID e LID mapeado, sobrevive à exclusão e é consultada em toda campanha. A confirmação só é enviada depois que o opt-out fica gravado.
5. **IA e dados de saúde** (médio): receita de óculos (grau, eixo, DNP), telefones em outros formatos, RG, datas e endereços agora são mascarados. Etiquetas, motivo de venda e objetivo da mensagem também passam pela anonimização. O playbook passou a contar como "dados de clientes". No modo Anonimizar, provedores que não treinam com os dados são usados primeiro.
6. **Mensagem apagada para todos** (médio): o conteúdo original continuava no banco e nos backups. Agora texto, original, mídia e o arquivo são removidos.
7. **Registros técnicos** (médio): a máscara de telefone agora vale para todos os campos do registro, inclusive os do Baileys. Nomes e textos de mensagem nunca vão para o log.
8. **Backup** (médio):
   - formato v2, com derivação de chave mais forte (scrypt N=2¹⁷, a recomendação da OWASP);
   - parâmetros gravados no cabeçalho, que agora é autenticado;
   - limite de tamanho ao descompactar;
   - a cópia temporária sem criptografia fica na pasta do app e é apagada sempre;
   - cópias antigas de antes de uma restauração são limpas depois de 7 dias;
   - a rotação apaga só os backups deste computador, então uma pasta compartilhada não perde os de outro;
   - backups v1 continuam restauráveis.
9. **Documentos recebidos** (médio):
   - ao salvar, o arquivo é marcado como baixado da internet (Windows: Zone.Identifier; Mac: quarentena), o que mantém os avisos do sistema e do Office;
   - o nome sugerido é limpo (sem `../`, caracteres de controle ou truques de direção do texto).
10. **Binário protegido contra injeção local** (médio): fusíveis do Electron desligam RunAsNode, NODE_OPTIONS e o inspetor, e exigem integridade do pacote.
11. **Mídias servidas ao app** (baixo):
    - só extensões conhecidas;
    - CSP `sandbox` e `nosniff`;
    - o que não é imagem, áudio ou vídeo é tratado como download.
12. **Origem das mensagens internas** (baixo): só a página principal do app (URL exata, quadro principal) pode chamar o processo principal. Também ficam bloqueadas a navegação em quadros, os redirecionamentos e os webviews.
13. **Planilhas** (baixo): a leitura para no limite de linhas e de 200 colunas.
14. **CSV** (baixo): quebra de linha `\r` dentro de um valor agora fica entre aspas.
15. **Linux sem chaveiro** (baixo): o modo `basic_text` do Electron não é mais considerado criptografia.
16. **Membros de grupos** (baixo): o app pede confirmação, com aviso de LGPD, antes de copiar os membros para Contatos.

### Bugs de funcionamento
1. **Contador de não lidas** (alto): o Baileys manda o incremento (+1) e o app gravava como total. Agora só valem 0 (lida no celular) e -1 (marcada como não lida).
2. **Mensagem que chega cifrada antes do conteúdo** (alto): o aviso "não pôde ser lida" nunca era trocado pelo texto real. Agora é substituído, e a mensagem notifica, conta como não lida e passa pelo SAIR e pelas automações.
3. **Mensagens recebidas com o app fechado** (alto): não passavam pelo SAIR nem pelas respostas automáticas. Agora mensagens com menos de 24 h passam. A notificação só aparece para mensagens com menos de 10 min.
4. **Duas conexões ao mesmo tempo** (alto): clicar em Conectar durante a espera de reconexão criava uma segunda conexão. Agora a espera é cancelada e a conexão antiga é encerrada e perde os ouvintes. Uma conexão antiga também não regrava mais as credenciais.
5. **Desafixar e tirar o silêncio** eram ignorados.
6. **Edição e apagamento** sobrescreviam o original guardado, o que quebrava o download de mídia.
7. **Pausar ou cancelar durante o "digitando…"** ainda enviava a mensagem.
8. **Módulo desligado**: uma campanha comum ainda podia iniciar se outro módulo estivesse ligado.
9. **Carregar mensagens antigas** pulava mensagens do mesmo segundo.
10. **Microfone** continuava ligado ao trocar de conversa durante a gravação.
11. **Criação de grupo em segundo plano** usava a conexão antiga e escondia as falhas.
12. **Busca de conversas** ("joao" achava "João", mas o resultado sumia) e respostas antigas que sobrescreviam a busca atual.
13. **Falhas seguidas** pausavam a campanha errada. A taxa de resposta era avaliada cedo demais; agora só conta envios com mais de 2 h.
14. **Busca de mensagens** mostrava resultados duplicados depois de unir conversas de LID.

## Pendente ou aceito

- **Assinatura de código** (médio):
  - sem certificado, a atualização automática no Windows confia só no hash do arquivo publicado. Quem invadir a conta do GitHub pode publicar uma versão maliciosa;
  - **mitigação até assinar:** 2FA obrigatório na conta `daniloarfaria` e token de publicação com escopo mínimo;
  - **solução:** certificado de assinatura no Windows (OV/EV ou Azure Trusted Signing) e Apple Developer ID no Mac, com hardened runtime e notarização. Isso também acaba com o pedido de senha do Keychain a cada versão.
- **Canais que recebem só o id** (baixo, aceito): o app tem um único usuário local e só a própria interface pode chamar esses canais.
- **Moderação com lista de participantes desatualizada** (baixo, aceito): atualizar a página Grupos renova a lista.
- **Restaurar um backup antigo traz a sessão antiga do WhatsApp** (baixo, aceito): o manual orienta ler o QR Code de novo depois de restaurar.

## Observações para os testes

- O app instalado bloqueia o modo de inspeção, que é a proteção dos fusíveis. Por isso os testes de interface automáticos (`tests/e2e`) rodam na versão não empacotada (`npx electron-vite build` + `node tests/e2e/…`).
- `npm test` roda 91 testes: regras, backup, conversas, LID, voz, importação, campanhas e motor (com um WhatsApp simulado), automações, grupos, lembretes, vendas, IA (roteador e anonimização) e LGPD.

---

## Segunda rodada: auditoria independente com o Codex (OpenAI)

> 05/11/2026 · Codex CLI em modo somente leitura · 23 achados (0 críticos, 11 altos, 12 médios). Os 13 novos e os 10 em que a correção anterior estava incompleta foram conferidos no código. Os testes passaram de 92 para 95.

### Corrigido
- **Mídia baixada de servidor escolhido pelo remetente (SSRF)** (alto): o Baileys usa o servidor que vem na mensagem.
  - Agora só são aceitos servidores do WhatsApp (https), e o caminho é validado.
  - O download é feito em fluxo, com teto de 120 MB.
- **Edição e apagamento sem conferir o autor** (alto): agora só o autor edita ou apaga. Uma mensagem já apagada não recebe conteúdo de volta num reenvio.
- **Reenvio (retry) entre conversas** (alto): o pedido de reenvio só devolve mensagens nossas da **mesma** conversa.
- **Trocar o telefone de um contato** (alto): o WhatsApp antigo é esquecido e os envios pendentes vão para o número novo.
- **Opt-out depois de exclusão via LID** (alto): se qualquer identidade (número, JID ou LID) pediu SAIR, a supressão vale para todas antes de apagar os mapas. Envios pendentes de um contato excluído são cancelados.
- **SAIR durante o "digitando…"** (alto): opt-out, existência do contato e status da campanha são conferidos imediatamente antes de cada envio.
- **Mistura de contas na interface** (alto): respostas atrasadas são descartadas ao trocar de conta, e os rascunhos são guardados por conta e conversa.
- **Planilha que "explode" ao abrir** (alto): antes de abrir, o app soma o tamanho real declarado no índice do arquivo e recusa compressão anormal.
- **Rajadas de envio automático** (médio): respostas automáticas, boas-vindas e moderação passam por uma fila por conta, com 3 a 7 s entre envios.
- **Intervalo de segurança encurtado** (médio): iniciar outra campanha ou salvar a Proteção não encurta mais uma espera ou pausa longa em andamento.
- **Envio parcial duplicado** (médio): com áudio, o destinatário é marcado como enviado logo após o áudio, e o texto seguinte não causa reenvio.
- **Vendas e automações ao unir conversas LID** (médio): agora acompanham a conversa.
- **Lembrete registrado antes de a campanha existir** (médio): o registro só acontece depois de a campanha ser criada e iniciada.
- **Backup adulterado com cálculo gigante** (médio): só são aceitos os perfis de derivação de chave conhecidos.
- **Corpo de erro de provedor de IA nos logs** (médio): não é mais guardado. O log tem rotação (cerca de 5 MB, atual + 1 anterior).
- **Paginação** (médio): o cursor exato (horário e posição) não pula nem repete mensagens.
- **Microfone aberto depois de sair da conversa** (médio): o app confere se a conversa continua aberta quando a permissão chega.
- **Reconexão concorrente depois do erro 405** (médio): cada conexão tem uma geração, e uma tentativa antiga não abre uma segunda conexão.
- **Expressões regulares lentas** (médio): a entrada de vCard e da anonimização é limitada.
- **Variações de campanha** (médio): não enviam mais o playbook para a IA.

### Aceito ou pendente
- **Dados em texto legível no SQLite e nas mídias do computador** (médio): o banco fica legível para quem tem acesso ao computador. Recomendação: criptografia de disco do sistema (FileVault no Mac, BitLocker no Windows) e senha de usuário. A sessão do WhatsApp e as chaves já são criptografadas.
- **Termos de saúde soltos no texto** (ex.: "tenho glaucoma") não são reconhecidos pela anonimização. Para conversas de saúde, use a privacidade **Estrita** (só provedores que não treinam) ou o Ollama local.
- **Assinatura de código:** continua pendente (veja acima).


## Terceira rodada: novas funções e retomada da integração

12/11/2026. Registro das correções já integradas em `e8c926f` (onda 5a),
conferidas novamente nos arquivos e testes durante a retomada do trabalho.
A auditoria original foi feita antes desta data; esta seção não representa
uma nova auditoria integral do aplicativo.

| Item | Correção e cobertura |
|---|---|
| 1 | Exclusão LGPD remove atribuição, modo/log do robô, leads e fila de contatos; variantes de telefone e LID em `people.ts` (`onda5-lgpd.test.ts`). |
| 2 | Filtro de linhas sensíveis antes da nuvem, inclusive fallback; playbook anonimizado (`ai/privacy.ts`, `onda5-robo.test.ts`). |
| 3 | Fusão LID/número preserva atendimento humano e cancela timers antigos (`wa/store.ts`, `onda5-robo2.test.ts`). |
| 4 | Envio manual assume atendimento antes do primeiro await (`ipc-chat.ts`, `onda5-robo.test.ts`). |
| 5 | Campanha e robô compartilham reserva atômica diária e bloqueio por conversa (`campaigns.ts`, `outbox.ts`, `onda5-envio.test.ts`). Parcial: ritmo e filas continuam separados. |
| 6 | Público do status respeita supressão por variantes e LID (`people.ts`, `onda5-status.test.ts`). |
| 7 | Mensagens automáticas não encerram a pergunta pendente (`autoMessages.ts`, `onda5-robo2.test.ts`). Registro somente em memória, TTL de 6 h. |
| 8 | Atendimento fora do horário reavalia o horário a cada mensagem (`iaAtendimento.ts`, `onda5-robo2.test.ts`). |
| 9 | Timeout de status conta no limite e retém a conta por 10 min (`status.ts`, `onda5-status.test.ts`). Parcial: reconciliação por retorno tardio, sem consulta ativa ao WhatsApp. |
| 10 | Troca de URL da planilha reinicia paginação e descarta fetch antigo por geração (`leadsPlanilha.ts`, `onda5-leads.test.ts`). |
| 11 | Reprocessamento de anúncios usa índice parcial e cursor por timestamp/rowid (`ads.ts`, `onda5-ads.test.ts`). Construção inicial do índice ainda é síncrona. |
| 12 | Criação de contatos dos leads em lotes de 50, cedendo o event loop (`leadsPlanilha.ts`, `onda5-leads.test.ts`). |
| 13 | Fusão da origem do anúncio preserva primeira atribuição como unidade (`ads.ts`, `onda5-ads.test.ts`). |
| 14 | Janela do funil acompanha a conversa após fusão LID/número (`chatStore.test.ts`); teste de store, sem cobertura visual do componente. |
| 15 | Ações IPC sem retorno informam sucesso à interface (`useAsync.test.ts` e usos de `attempt`). |
| 16 | Janela por minuto só é mantida para provedores com RPM e é apagada ao remover provedor (`ai/router.ts`). |
| 17 | Limpeza periódica de mídia do status tolera JSON inválido e falha por arquivo (`onda5-status.test.ts`). |

Na retomada, os 516 testes da base passaram. A falha intermitente
`UNIQUE campaign_targets.campaign_id, campaign_targets.seq` foi reproduzida
fixando `Date.now()` em `tests/engine.test.ts`: o gerador derivava sequências
do horário e repetia chaves entre lotes. A sequência passou a ser incremental,
mantendo o relógio fixo como regressão. O teste de backup também passou;
o timeout antigo não foi reproduzido e a criptografia não foi alterada.

O envio de eventos à Meta continua bloqueado por decisão do usuário.
Publicação, alteração de versão e merge em `main` não fazem parte desta retomada.


Na integração de 12/11/2026, recuperação de vendas recebeu reserva diária
atômica, bloqueio por conversa, filtro sensível na nuvem e exclusão dos
acompanhamentos/tentativas. A revisão independente do commit `182c325`
encontrou e levou à correção de concorrências durante classificação, geração
e digitação: exclusão/SAIR, fusão LID/número e mudança de envio automático
para aprovação. Cobertura em `recuperacao.test.ts` e `recuperacao2.test.ts`.
A revisão não encontrou achados importantes restantes nesse escopo; isso
não equivale a uma nova auditoria integral.

Provedores: controles de uso com clientes também valem para transcrição;
NVIDIA e DeepSeek começam sem uso de conversas de clientes; limites mensais
são por provedor. Validação e fontes em `PROVEDORES-VALIDACAO.md`.
A ordem das migrações preserva a base e acrescenta recuperação, depois as
duas migrações dos provedores. A suíte integrada passou em 684/684 testes
(40 arquivos), antes da correção adicional do botão de teste de campanha.

Referência de desempenho e limitações em `DESEMPENHO.md`: banco sintético
de 500 mil mensagens/20 mil conversas; sem medir memória do Electron,
latência de inferência ou funcionamento com conta WhatsApp real.


Validação final da retomada: 697 testes passaram em 41 arquivos, incluindo
13 regressões do botão “Enviar teste para mim”. O botão agora envia o
anexo selecionado mesmo antes de salvar, reaproveita o anexo salvo ao editar
e respeita sua remoção. Conferência de propriedade impede usar anexo de
outra conta. Revisão independente do commit `6a5b24a` sem achados importantes.
Typecheck, build e ESLint passaram (os dois tipos de retorno faltantes nos
helpers do novo teste foram acrescentados após a primeira execução do lint).

O smoke visual `tests/e2e/ia-shots.mjs` abriu Meu negócio e Configurar IA
nos temas claro/escuro em perfil temporário. Não houve exceção da página;
o console registrou o aviso de CSP `frame-ancestors` ignorada em meta,
que já existe no HTML e não impede abrir as telas. Capturas locais em
`/tmp/nexu-retomada-telas/`. Nenhuma mensagem real foi enviada e não houve
inferência paga: o envio do anexo foi validado com socket simulado.


## Validação das funções adicionais — 12/11/2026

- Campanhas: texto e mídia permanecem associados por versão. Prévia mostra imagens, vídeos, áudio ou arquivo; gravação é convertida para Ogg/Opus. Salvamento de versões e anexos é atômico, com rollback em falha; anexos antigos permanecem compatíveis.
- Voz: instalação guiada com cancelamento, progresso e SHA-256. Mac inclui Whisper e FFmpeg mínimo LGPL, sem depender de Homebrew/Xcode no computador do cliente. Transcrição real em português validada; x64 inspecionado sem execução, Windows não executado e requer VC Runtime quando ausente (erro explícito antes do modelo). Fontes, licenças e hashes em `resources/transcribe/README.md`.
- Contatos: campos do negócio separados por conta, com valores antigos preservados. Apagar para todos atualiza conteúdo/FTS local somente após envio bem-sucedido; erros mantêm o conteúdo.
- Impressão: imagens e PDFs das conversas abrem diálogo nativo em janela isolada. Conta/mensagem/caminho e tipo são validados; SVG/HTML e visualização única não são aceitos. Teste Electron confirmou PDF renderizado, impressão não silenciosa interceptada e limpeza ao cancelar; nenhum trabalho físico foi enviado. O teste deve ser repetido ao atualizar Electron, pois a espera do visualizador usa sua API interna.
- Licenças: o mesmo login pode selecionar uma entre várias licenças efetivas. Plano/cota não são somados. Senha fica somente em memória até escolher/cancelar; renovação não pode trocar o ID da licença assinada. Cota reduzida suspende excedentes por ordem estável, preservando dados e autenticação; conexão e socket usados por envios ficam bloqueados.

Na suíte integrada, 770 testes passaram e um smoke com download real ficou
fora da execução padrão; esse smoke foi executado separadamente na frente
de voz. Typecheck e ESLint passaram. E2E em perfil temporário confirmou
mídias por versão, gravação, reabertura e campos na ficha.

Site de licenças: repositório irmão `nexu-chat-licencas`, com seleção/vínculo
de sessão por licença e plano de atualização em seus docs. Migração SQL
validada em PostgreSQL isolado (PGlite), incluindo quota, isolamento de
cliente, revogação, migração legada e permissão negada ao papel público.
Concorrência real entre conexões PostgreSQL não foi simulada. Migração e
publicação do site em produção não foram executadas.
