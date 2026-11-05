# Especificação — App de Campanhas e Gestão de WhatsApp

> Nome provisório no código: `disparador`. O nome definitivo será escolhido depois.
> Data: 05/11/2026 · Substitui o bot `Automacao_Otica` (que vai para `legacy/`).

## 1. Objetivo
App desktop instalável no **Mac (.dmg)** e no **Windows (.exe)** para pequenos negócios (óticas e outros)
enviarem campanhas, gerirem grupos e atenderem clientes pelo WhatsApp, com proteção contra bloqueio,
segurança e visual moderno.

## 2. Arquitetura
| Camada | Escolha | Motivo |
|---|---|---|
| Desktop | Electron + electron-vite | Um código para Mac e Windows |
| Interface | React + TypeScript + Tailwind + shadcn/ui | Visual moderno, tema claro/escuro |
| Motor WhatsApp | Baileys (WebSocket, sem Chrome) | Leve, LID nativo, várias contas |
| Banco | SQLite (better-sqlite3), um arquivo por perfil | Local, rápido, backup simples |
| Instalador/atualização | electron-builder + electron-updater (GitHub Releases) | .dmg/.exe e auto-update do app |
| Segredos | `safeStorage` do Electron (Keychain/DPAPI) para chaves e sessões | Sessão do WhatsApp criptografada |

Segurança do Electron: `contextIsolation`, `sandbox`, sem `nodeIntegration`, IPC tipado e validado (zod),
CSP restrita, nenhum servidor HTTP aberto na rede, nenhum `npm install` em tempo de execução.

## 3. Atualização automática da versão do WhatsApp
1. Ao abrir: lê `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json`
   (mesma fonte de wppconnect.io/pt-BR/whatsapp-versions) → `currentVersion` `2.3000.N` → `[2,3000,N]`.
2. Falhou → `fetchLatestWaWebVersion()` do Baileys.
3. Falhou → última versão que funcionou (salva no banco).
4. Rechecagem a cada 6 h e ao receber erro de versão desatualizada (reconecta sozinho).
5. Versão em uso visível na tela de Status.

## 4. Módulos (cada um pode ser **ligado/desligado** por conta em Configurações → Módulos)

### 4.1 Contas / clientes
- Várias contas WhatsApp no mesmo app (Ótica A, Ótica B, outros negócios), conexão por QR Code ou código de pareamento.
- Cada conta tem seus contatos, campanhas, grupos, regras e limites.

### 4.2 Contatos
- Importar Excel/CSV com mapeamento de colunas, normalização de telefone BR (DDD, 9º dígito), deduplicação.
- Tags/segmentos, campos personalizados (aniversário, data da compra, loja, cidade…).
- Lista de opt-out permanente ("SAIR"), nunca recebe campanha.
- Verificação se o número tem WhatsApp (com resolução de LID).

### 4.3 Campanhas
- Texto + imagem/vídeo/PDF/áudio, variáveis `{nome}`, `{loja}`… e **spintax** `{Oi|Olá|E aí}`.
- Pré-visualização estilo celular, envio de teste para o próprio número.
- Agendamento, pausar/retomar, fila persistente (sobrevive a fechar o app/queda de internet), reenvio de falhas.
- Relatório: enviadas, entregues, lidas, respondidas, falhas, opt-outs; exportar Excel.

### 4.4 Proteção anti-bloqueio (padrões ajustáveis por conta)
- Intervalo aleatório (padrão 60–180 s), pausa longa a cada 15–20 envios (10–20 min).
- **Limite diário** real por conta (não por sessão) e janela de horário comercial.
- Modo aquecimento para número novo (limite cresce gradualmente).
- Simulação de "digitando", variação de texto obrigatória, alerta se a campanha tem link.
- Monitor de saúde: taxa de resposta e de falhas; pausa automática se a taxa de resposta cair < 15% ou houver sinais de restrição.
- Rodapé opcional "Responda SAIR para não receber mais".

### 4.5 Grupos (cada função liga/desliga separadamente)
- **Envio para grupos:** campanhas/agendamentos para vários grupos.
- **Extrair membros:** exportar participantes para Contatos/Excel.
- **Criar grupos:** a partir de lista/planilha, com foto, descrição, admins (em lotes lentos).
- **Moderação:** boas-vindas, remover quem envia link/palavras proibidas, avisos, regras.

### 4.6 Conversas (receber e enviar mensagens)
- Caixa de entrada completa, estilo WhatsApp: todas as conversas (individuais e grupos) chegam em tempo real e ficam salvas no banco local.
- Enviar texto, emoji, imagem, vídeo, áudio, documento; responder citando; ver status (enviada/entregue/lida).
- Iniciar conversa nova com qualquer contato, buscar no histórico, filtros (não lidas, respondeu campanha, grupos, etiqueta).
- Marcar como resolvido, etiquetas, notas internas, opt-out automático por palavra-chave ("SAIR").
- Notificação do sistema ao chegar mensagem.
- **Sincronização do histórico:**
  - ao conectar a conta pela primeira vez, o app importa o histórico que o WhatsApp entrega para aparelhos vinculados: conversas, contatos, grupos e mensagens. É o mesmo que o WhatsApp Web/Desktop recebe; a quantidade de meses depende do celular;
  - toda vez que o app abre, ele recebe o que chegou enquanto estava fechado, e tudo vai para o banco local;
  - progresso da sincronização visível na tela, e mensagens duplicadas são ignoradas;
  - se faltar histórico, há a opção "Reimportar histórico" (desvincula e vincula de novo a conta).
- **Todos os tipos de mídia, para receber e para enviar:**
  - texto, imagem, vídeo, áudio e mensagem de voz (com gravação pelo app), documento, figurinha;
  - localização, contato (vCard), enquete, reação, mensagem editada ou apagada, visualização única e status/stories;
  - as mídias são baixadas e guardadas numa pasta do app, com regras de limite de tamanho e limpeza automática configuráveis, e entram no backup de forma opcional.

### 4.7 Respostas automáticas
- Por palavra-chave, fora do horário comercial, primeira mensagem, com limite para não gerar loop.

### 4.8 Lembretes recorrentes
- Aniversário, "seu óculos está pronto", revisão anual de grau, pós-venda (X dias após compra) — com base nos campos do contato.

### 4.9 Vendas
- Na conversa, o operador marca **"Virou venda"**: valor, produto/categoria, forma de pagamento, observação, data.
- Também marca "Perdida" com motivo (preço, sem estoque, só pesquisando…), para aprender com o que não fechou.
- Cada venda fica ligada à origem: campanha, lembrete, grupo ou conversa espontânea, e isso dá o **retorno por campanha** (R$ vendidos ÷ mensagens enviadas).
- Painel de vendas: faturamento pelo WhatsApp, ticket médio, taxa de conversão por campanha e por atendente, funil (respondeu → negociou → comprou).

### 4.10 Assistente de IA
- **Análise de conversas:** lê as conversas que viraram venda e as perdidas e aponta o que funcionou (abordagens, objeções frequentes, tempo de resposta, horários).
- **Playbook de vendas:** monta e atualiza um playbook da loja com abordagens que convertem, respostas para objeções, gatilhos e scripts. O playbook pode ser editado e exportado.
- **Mensagens personalizadas:** sugere a resposta na conversa (o operador revisa antes de enviar) e gera variações de campanha personalizadas por cliente, a partir do histórico e das compras dele.
- **Roteador de modelos com APIs gratuitas** (lista *Awesome Free LLM APIs*), para gastar o mínimo:
  - provedores compatíveis com a API da OpenAI cadastrados com a chave de cada um: Groq, Google Gemini, OpenRouter (modelos `:free`), Mistral, Cerebras/NVIDIA NIM, Cloudflare Workers AI e outros da lista;
  - **alterna sozinho entre eles:** quando um atinge o limite (erro 429 ou cota do dia), passa para o próximo da fila e volta ao primeiro quando o limite renova. O app controla quantas requisições por minuto e por dia usou de cada um;
  - **escolhe o modelo pela tarefa:**
    - sugestão de resposta curta → modelo rápido (ex.: Groq);
    - análise de muitas conversas e montagem do playbook → modelo de contexto longo (ex.: Gemini);
    - textos de campanha → o melhor modelo disponível no momento;
  - **pagos como reserva opcional:** Claude (chave da agência) só quando todos os gratuitos falharem ou para tarefas marcadas como "qualidade máxima", com teto de gasto mensal;
  - modelo local (Ollama) como opção de privacidade total;
  - painel de uso mostrando chamadas por provedor, limite restante e custo do mês (R$ 0 nos gratuitos).
- **Privacidade nos gratuitos (importante):** vários planos gratuitos usam os dados enviados para treinar modelos. É o caso do Gemini gratuito fora da Europa, do Mistral no modo gratuito e das rotas `:free` do OpenRouter. Por isso:
  - cada provedor é marcado como "pode treinar com os dados: sim/não";
  - conversas reais de clientes só vão para provedores marcados "não", ou passam antes por anonimização forte (sem nome, telefone, CPF, endereço, valores);
  - tarefas sem dados de clientes podem usar qualquer provedor gratuito, como criar o texto de uma campanha a partir de um tema;
  - a loja escolhe o nível de privacidade nas configurações.
- **LGPD e privacidade:**
  - liga e desliga por conta;
  - telefones e documentos são mascarados antes de ir para a IA;
  - só conversas de quem não pediu exclusão entram na análise;
  - registro do que foi enviado;
  - a IA nunca envia mensagem sozinha sem a regra ter sido configurada.

### 4.11 Sistema
- Painel inicial (status das contas, envios do dia, saúde, próximas campanhas).
- **Banco de dados local** (SQLite): contatos, conversas, mensagens, mídias, campanhas, configurações — tudo fica no computador.
- **Backup em pasta configurável:** escolher qualquer pasta (ex.: Google Drive, OneDrive, HD externo); backup automático (diário/semanal/ao fechar o app) e manual; mantém os últimos N backups; arquivo compactado e criptografado com senha; restaurar backup pelo app (também serve para migrar para outro computador).
- Logs sem telefone completo (mascarado), exportação de dados (LGPD), excluir contato a pedido.
- Senha/PIN opcional para abrir o app.

## 5. Fases de entrega
1. ✅ **Base:** projeto Electron, segurança, banco local, backup em pasta configurável, contas, conexão Baileys com versão automática, Status. Instalador Mac/Windows.
2. ✅ **Conversas:** sincronização do histórico, receber e enviar mensagens com todos os tipos de mídia (caixa de entrada completa).
3. **Disparos:** contatos/importação, campanhas, fila, anti-bloqueio, relatórios (paridade + correções do bot antigo).
4. **Respostas automáticas + opt-out.**
5. **Grupos** (4 funções com liga/desliga).
6. **Lembretes recorrentes.**
7. **Vendas** (marcar venda/perdida, retorno por campanha, painel).
8. **Assistente de IA** (análise, playbook, mensagens personalizadas).
9. **Auditoria final** (security-audit, code-review, testes), assinatura opcional, publicação.

## 6. Riscos
- Uso de cliente não oficial viola os Termos do WhatsApp: sempre há risco de banimento; o app reduz, não elimina.
- Baileys 7 ainda é release candidate; fixar versão e testar antes de atualizar.
- Sem certificado: Mac pede "clique direito → Abrir", Windows mostra SmartScreen.
- Dados de clientes: LGPD — base legal (clientes que já compraram), opt-out e exclusão.
