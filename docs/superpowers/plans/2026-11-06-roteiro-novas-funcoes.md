# Roteiro das novas funções do Nexu Chat

> Roteiro geral (06/11/2026). São 11 pedidos com partes independentes. Cada onda ganha um plano detalhado, com testes passo a passo, em `docs/superpowers/plans/`, antes de começar. Execução prevista: um agente por função, com revisão antes de juntar.

**Objetivo:** o Nexu Chat passa de "ferramenta de disparo e atendimento" a "atendente com IA que vende, recupera e mede", sem perder o princípio local e seguro.

**Base:** levantamento do código feito em 06/11/2026 (caminhos e linhas citados abaixo) e pesquisa na documentação da Meta (seção 10).

## Regras para todas as funções

- Português do Brasil em toda a interface. Atualizar o `docs/MANUAL.md` a cada função (regra do README).
- Os dados continuam no computador da loja. Só sai o que a função exige, e a tela diz o que sai: IA na nuvem, Meta e Google Planilhas.
- Anti-bloqueio vale para tudo que a IA ou o app enviarem sozinhos: passar pelo `enqueueSend` (`src/main/outbox.ts`), contar no limite diário (`countSend`, `src/main/campaigns.ts:44`), respeitar o horário e quem pediu para não receber (`suppression`).
- A IA nunca inventa preço, prazo ou desconto que não esteja no contexto do negócio ou na regra configurada.
- Migrações do banco de dados (`MIGRATIONS` em `src/main/db.ts`):
  - O app aplica as migrações pela **posição** no array (`PRAGMA user_version`, `db.ts:423`), então não dá para reservar números.
  - Cada agente **acrescenta a sua migração no fim** do array, como um bloco só e com um comentário com o nome da função.
  - Ao juntar os branches, quem integra coloca as migrações em ordem. Nenhuma migração já lançada muda de posição.
- Todo segredo (token da Meta, senha da planilha, chave de IA) é guardado com `sealString` (`src/main/secure.ts`).
- Teste com Vitest no padrão de `tests/business.test.ts`: o `electron` é simulado e cada teste usa um banco de dados temporário.

---

## 1. Contexto geral do negócio

**Hoje:** a IA só conhece o nome da loja e o playbook (`storeContext`, `src/main/ai/assistant.ts:70`).

**Novo:** a página **Assistente de IA**, na aba **Meu negócio**, guarda um contexto por número de WhatsApp. Os campos:
- o que a loja vende e para quem;
- produtos e serviços, com preço e prazo;
- horário de funcionamento e endereço;
- formas de pagamento;
- políticas de troca, garantia e entrega;
- perguntas frequentes;
- tom de voz;
- o que a IA **não** pode falar.

Detalhes:
- Botão **"Preencher com a IA"**: o dono cola o texto do site ou do Instagram, e a IA organiza nos campos.
- Fica guardado no `settings` (chave `ai.context.<accountId>`), sem migração.
- Uma função `businessContext(accountId)` alimenta tudo: sugestão de resposta, robô de atendimento, acompanhamento automático, variações de campanha e playbook. Limite de tamanho, com corte por prioridade.

## 2. Configurar a IA em um passo, com o motor local instalado sozinho

**Hoje:** o dono cadastra provedores um a um (`src/main/ai/router.ts`). O Ollama já é aceito (linha 73), mas precisa ser instalado à mão.

**Novo:** o botão **"Configurar IA"** abre um assistente de uma tela só.
1. O app olha o computador: memória, processador e espaço em disco.
2. Ele mostra a recomendação:
   - **IA no computador** (privada, grátis, sem internet): se houver memória suficiente.
   - **IA gratuita na nuvem** (mais rápida): abre o site do Groq e só pede para colar a chave. Sem formulário.
   - As duas juntas: a IA local como principal e a nuvem como reserva. O roteador já troca de provedor sozinho.
3. Instalação local, sem pedir senha de administrador:
   - baixa o `llama-server` (llama.cpp, versão fixa, do GitHub oficial) para o sistema e o processador da loja;
   - baixa um modelo pequeno em português, com tamanho conforme a memória (a escolha de modelo é fixada no plano da onda);
   - confere o SHA-256 de tudo, mostra o progresso e retoma se a internet cair;
   - guarda em `userData/ai-local/`;
   - roda em `127.0.0.1` numa porta livre;
   - se cadastra sozinho como provedor no formato OpenAI. O `validateBaseUrl` já aceita localhost.
4. **Modelos por tarefa.** O app usa o menor modelo que dá conta de cada tarefa. As versões exatas e o SHA-256 são fixados no plano da onda 1, depois de um teste em português no PC mais fraco.
   - **Leve, cerca de 1 a 2 GB** (Qwen3 1.7B, Gemma 3 1B ou Llama 3.2 1B):
     - classificar intenção e interesse de compra;
     - detectar "quero falar com uma pessoa" e escolher o atendente;
     - tirar datas da conversa;
     - etiquetar.
   - **Médio, cerca de 2,5 a 3 GB** (Qwen3 4B, Gemma 3 4B ou Phi-4-mini):
     - sugerir resposta;
     - mapear o perfil;
     - escrever o acompanhamento automático;
     - criar variações de campanha;
     - preencher o contexto do negócio.
   - **Robô de atendimento:** médio, se o computador aguentar; senão, nuvem gratuita com o modelo local de reserva.
   - **Transcrição:** whisper.cpp com o modelo `base` ou `small` em português (150 a 500 MB).
   - **Memória baixa é requisito (Danilo, 06/11/2026).** Regras:
     - **Padrão: só um modelo pequeno**, de 0,6B a 1,7B em quantização Q4, com **teto de cerca de 1,2 GB de memória** durante o uso. As tarefas maiores vão para a nuvem gratuita.
     - **O modelo médio é opcional:** só aparece como opção com 16 GB ou mais, e a loja precisa ligar.
     - **Carrega quando precisa e solta depois:** o motor sobe na primeira tarefa e fecha após 5 minutos parado. Parado, gasta zero de memória.
     - **Nunca dois modelos ao mesmo tempo:** a fila de tarefas da IA local é uma por vez, e o Whisper e o modelo de texto não rodam juntos.
     - **Configuração enxuta:**
       - contexto curto (2048 a 4096 tokens, já que as conversas vão resumidas);
       - `mmap` ligado, para o sistema poder devolver memória;
       - processamento limitado à metade dos núcleos, para o computador da loja não travar.
     - **Medição obrigatória** no plano da onda 1: memória de pico e em repouso, e tempo de resposta, no PC mais fraco. Se passar do teto, o modelo é trocado.
     - **O Whisper já roda como processo separado** (`execFile`) e solta a memória ao terminar. Isso continua assim.
   - O roteador ganha o campo `tier: 'fast'|'smart'` por tarefa (já existe em `AiRequest`): `fast` vai para o leve e `smart` para o médio.
5. **Alternativa a avaliar no plano:** `node-llama-cpp` (pacote npm sobre o llama.cpp, com binários prontos e GPU detectada sozinha: Metal, CUDA ou Vulkan). Roda dentro do processo do app, sem servidor separado. O ponto a ver é o peso no instalador e o empacotamento com os fusíveis do Electron.
6. Por que o llama.cpp e não o Ollama: não precisa de instalador do sistema nem de permissão de administrador, o app controla a versão e o desinstalar apaga só uma pasta.

**Bônus:** o mesmo instalador pode baixar o `whisper.cpp` para a transcrição local. Hoje a transcrição exige o Homebrew (`src/main/wa/transcribe.ts:55-59`).

**Aviso honesto na tela:** em PC fraco, a IA local responde devagar. Para o robô de atendimento, a recomendação é a nuvem com a local de reserva.

## 3. Tela inicial = Conversas

**Hoje:** a tela inicial é fixa (`page: 'inicio'`, `src/renderer/src/lib/store.ts:57`). `Inicio.tsx` mostra os números conectados, o backup e a versão do WhatsApp Web.

**Novo:**
- `page: 'conversas'` vira o padrão.
- O conteúdo do Início vai para uma aba nova, **Visão geral**, a primeira das Configurações (`src/renderer/src/pages/Configuracoes.tsx:432`).
- Se não houver número conectado, Conversas mostra o "Conecte seu WhatsApp" com o botão que leva às Contas.
- Sai o item "Início" da barra lateral.

## 4. Funil com a conversa numa janela flutuante

**Hoje:** clicar num cartão abre a gaveta `CardDrawer` (`src/renderer/src/pages/funis/drawers.tsx:39`). O botão "Conversa" troca de tela.

**Novo:** clicar no cartão abre uma janela flutuante grande:
- **à esquerda**, a conversa completa, com histórico e caixa de envio;
- **à direita**, os dados do cartão (coluna, valor, etiquetas, nota) e o bloco de notas do cliente (função 5).
- **Esc** ou clique fora fecha, e o funil continua onde estava.

**Obstáculo técnico:** `ChatView` e `Composer` leem o estado global `useChats` (`src/renderer/src/lib/chatStore.ts:60`). A janela não pode "roubar" a conversa aberta na tela Conversas.

**Solução:**
- transformar o estado da conversa em fábrica (`createChatStore()`), com um contexto React;
- a tela Conversas usa a instância principal, e a janela usa uma instância própria;
- exportar o `ChatView` e criar o componente `Modal` em `ui.tsx` (ainda não existe).

## 5. Bloco de notas do cliente, com a IA mapeando o perfil

**Hoje:** não existem notas por cliente. Só há a nota do negócio e a do cartão.

**Novo:** tabela `contact_notes` (v8), com os campos:
- `id`, `account_id`, `person_id`;
- `kind`: `geral`, `perfil`, `preferencia`, `objecao` ou `familia`;
- `title`, `body`;
- `author`: `atendente` ou `ia`;
- `pinned`, `created_at`, `updated_at`.

Onde aparece:
- na ficha do contato, na faixa da conversa e na janela do funil;
- dá para criar várias notas, fixar, editar e apagar.

**IA mapeia o perfil:**
- **Quando roda:**
  - pelo botão **"Mapear perfil"**;
  - sozinha, quando a conversa fica 2 horas parada depois de ter pelo menos 10 mensagens novas.
- **O que gera:** notas marcadas "IA", sempre editáveis. Exemplos: "usa óculos multifocal", "prefere armação leve", "comprou para a filha", "achou caro".
- **Não duplica:** a IA recebe as notas que já existem e só propõe o que é novo.

**Uso:**
- As notas vão no contexto da sugestão de resposta, do robô e do acompanhamento automático, anonimizadas.
- Excluir o contato (LGPD) apaga as notas.

**LGPD:** traçar o perfil de uma pessoa é tratamento de dados pessoais. Por isso:
- dá para desligar a função em Módulos;
- não guarda dado sensível (saúde, religião etc.). Grau de óculos é dado de saúde: a IA não anota, e o anonimizador já mascara receitas.

## 6. Aniversário e datas registrados no contato

**Hoje:**
- O aniversário fica em `people.birthday`, e as outras datas em `people.fields` (`src/main/reminders.ts:100-111`).
- Os lembretes já leem essas datas.
- Falta ver e editar isso direito na ficha, e o envio não aparece no contato.

**Novo:**
- **Ficha do contato:** campo de aniversário com idade e "faltam X dias", e as datas personalizadas com o nome do campo.
- **Histórico do contato:** "Lembrete de aniversário enviado em 12/03/2027", com uma linha por envio. Vem do `reminder_log` e do `campaign_targets` já existentes.
- **Captura automática:**
  - se o cliente disser a data de nascimento na conversa, a IA sugere "salvar 12/03 como aniversário?";
  - o atendente confirma com um clique;
  - nada é salvo sem confirmação.
- **Lembretes de aniversário prontos** ligados por padrão quando a loja ativa o módulo.

## 7. Postar imagens e vídeos no status

**Hoje:** o app ignora o `status@broadcast` (`src/main/wa/store.ts:16`). O Baileys consegue postar com `statusJidList` (`lib/Socket/messages-send.js:527`, confirmado no pacote instalado).

**Novo:** página **Status**, ligada em Módulos.
- **O que posta:** texto com cor de fundo, imagem ou vídeo, com legenda.
- **Quem vê:**
  - todos os contatos com WhatsApp; ou
  - quem tem uma etiqueta; ou
  - todos menos uma etiqueta.
- **Quando:** agora ou agendado. O mesmo agendador das campanhas fica de olho na hora.
- **Histórico:** lista do que foi postado, com data e público. Quem viu, só se o Baileys entregar os recibos; isso é conferido no plano.
- **Tabela** `status_posts` (v10).
- **Proteção:**
  - limite de postagens por dia;
  - aviso para listas grandes. A lista de quem vê é enviada junto com a postagem, e com milhares de contatos o envio fica pesado. O teste real define o teto.

## 8. Robô de atendimento com IA

**Hoje:** nada responde sozinho com IA. As respostas automáticas são por palavra-chave (`src/main/automation.ts:167`).

**Novo:**
- **Por número:** robô ligado ou desligado, e quando ele atende:
  - sempre;
  - só fora do horário;
  - só conversas novas.
- **Por conversa:** modo `ia` ou `humano` (tabela `chat_ai_mode`, v9).
  - O botão no topo da conversa alterna entre **"Assumir atendimento"** e **"Devolver para a IA"**.
  - Uma etiqueta visível mostra quem está atendendo.
- **Passa para o humano sozinho quando:**
  - o atendente digita na conversa: assume na hora;
  - o cliente pede uma pessoa;
  - a IA não sabe a resposta pelo contexto;
  - a conversa chega na hora de fechar a venda, se a loja configurar assim;
  - aparece reclamação ou palavra de risco.
  - Em todos os casos, o app avisa o atendente com uma notificação.
- **Contexto que a IA usa:**
  - o contexto do negócio (função 1);
  - o playbook;
  - as notas do cliente;
  - as últimas mensagens, anonimizadas;
  - um **contexto extra por conversa** que o atendente pode escrever (ex.: "ofereça a armação X").
- **Segurança:**
  - não responde em grupos;
  - respeita "SAIR";
  - tem limite por hora e por conversa;
  - mostra "digitando…" com atraso humano;
  - se o provedor de IA cair, para e passa ao humano, sem mandar texto genérico.
- **Onde liga no código:** `storeEvents.on('incoming')`, depois do opt-out e das respostas automáticas por palavra-chave, que têm prioridade.

## 9. Recuperação de vendas com desconto

**Novo:** regra por número, em **Automações → Recuperar vendas**.
- **Quando entra:** a loja respondeu e o cliente sumiu por X horas (padrão 24 h). Isso vale:
  - em conversa marcada como orçamento;
  - em cartão de funil fora de ganho ou perdido;
  - ou em qualquer conversa com interesse de compra. A IA classifica o interesse.
- **Sequência:** até 3 tentativas (ex.: 1, 3 e 7 dias), cada uma escrita pela IA com o contexto e a conversa.
- **Desconto:**
  - percentual configurável;
  - a partir de qual tentativa ele entra (padrão: só na última);
  - validade em dias;
  - teto opcional em reais;
  - texto da condição: "na compra à vista", por exemplo.
  - A IA usa exatamente esse número e não negocia além dele.
- **Modo de envio:**
  - **aprovar antes** (padrão, por decisão do Danilo): a mensagem fica na fila "Para aprovar" e sai com um clique;
  - ou **automático**, ligado em cada regra.
- **Para sozinha quando:**
  - o cliente responde;
  - a venda é marcada (ganha ou perdida);
  - o cliente pede para não receber;
  - o atendente assume.
- **Medição:** a venda recuperada entra em Vendas com origem "Recuperação". O painel mostra quanto voltou e quanto custou em desconto.
- **Tabelas** `followups` e `followup_attempts` (v9).

## 10. Meta: anúncios e API de Conversões

### O que a documentação da Meta diz (pesquisa de 06/11/2026)

**O caminho oficial com o `ctwa_clid`:**
- Endpoint: `POST graph.facebook.com/v27.0/{dataset_id}/events`, com `action_source: "business_messaging"`, `messaging_channel: "whatsapp"` e `user_data: { whatsapp_business_account_id, ctwa_clid }`.
- Eventos aceitos: `LeadSubmitted`, `QualifiedLead`, `InitiateCheckout`, `AddToCart`, `ViewContent`, `Purchase`, `OrderCreated`, `OrderShipped`, `OrderDelivered`, `OrderCanceled`, `OrderReturned`, `CartAbandoned`, `RatingProvided` e `ReviewProvided`.
  - O `Lead` comum **não** está na lista.
- Fonte: developers.facebook.com/docs/marketing-api/conversions-api/business-messaging

**Problema 1: o caminho oficial é só para a API oficial.**
- O `ctwa_clid` é documentado apenas na Cloud API e na On-Premises API.
- Para quem usa o app WhatsApp Business, o único caminho oficial é a **coexistência** (o número no app e na Cloud API ao mesmo tempo). Ela exige ser parceiro da Meta (Tech Provider) com Embedded Signup.

**Problema 2: o `ctwaClid` não chega pelo WhatsApp Web.**
- O proto do Baileys tem o campo (`ExternalAdReplyInfo.ctwaClid`).
- Os relatos de 2026 (Baileys #2354) mostram que, em dispositivo vinculado, chegam só:
  - `conversionSource: "FB_Ads"` e `entryPointConversionSource: "ctwa_ad"`;
  - o `ctwaPayload`, criptografado.
- A primeira mensagem do anúncio às vezes nem chega ao dispositivo vinculado (Baileys #2408, ainda aberta).

**Caminho oficial sem `ctwa_clid`:**
- É o mesmo `business_messaging`, mas com `page_id` e telefone em SHA-256 (o padrão é `55` + DDD + número).
- A Meta diz que o casamento "não é garantido".
- A janela de atribuição é de 7 dias.
- A Meta **não** remove eventos duplicados nesse produto: o app precisa fazer isso.

**Contraponto do Danilo (06/11/2026):** ele já capturava o `ctwa_clid` pela Evolution API, que também usa o Baileys. Então o campo chega, pelo menos em parte dos casos. A falha relatada na issue #2354 pode ter sido pontual.

O Baileys do app (`7.0.0-rc14`) também já pede ao celular o reenvio das mensagens de anúncio (`requestPlaceholderResend`, `lib/Socket/messages-recv.js:56`). É a correção do PR #2334.

**Por isso, a onda 2 começa com um teste real:**
- clicar num anúncio de clique para o WhatsApp de um cliente;
- conferir no `raw` da mensagem se o `externalAdReply.ctwaClid` veio.

O que muda conforme o resultado:
- **Se vier:** o envio principal é o oficial com `ctwa_clid` + WABA ID, e o telefone em hash fica de reserva.
- **Se não vier:** só o telefone em hash.

Antes do teste, perguntar ao Danilo qual dataset e qual WABA ID ele usava com a Evolution.

### Proposta (depende da decisão do Danilo; ver o fim)

**A. Captura (vale em qualquer caminho):**
- Ler do `contextInfo` das mensagens recebidas:
  - `conversionSource` e `entryPointConversionSource`;
  - do `externalAdReply`: `sourceId` (o ID do anúncio), `sourceUrl` e `ctwaClid`, se vierem.
- Guardar em `chat_attribution` (v12).
- Reprocessar o histórico a partir de `messages.raw`, no mesmo padrão de `reparseUnsupported`, em `src/main/wa/store.ts:720`.
- A conversa ganha a etiqueta "Veio de anúncio" e a venda ganha a origem "Anúncio". Isso já é útil no painel mesmo sem a Meta.

**B. Envio por etapa do funil:**
- Cada coluna do funil ganha **"Avisar a Meta"**, com um evento de uma lista. Sugestão:
  - Novo contato → `LeadSubmitted`
  - Qualificado → `QualifiedLead`
  - Orçamento enviado → `InitiateCheckout`
  - Ganho → `Purchase`, com o valor do cartão ou da venda
- Marcar **"Virou venda"** na conversa também envia `Purchase`.
- **Como envia:**
  - com `ctwa_clid` + WABA ID, se existir;
  - senão, pelo caminho oficial com telefone em hash + `page_id`.
- **Sem duplicar:** a tabela `capi_events` (v12) não deixa o mesmo evento sair duas vezes para a mesma pessoa e etapa.
- **Envio garantido:** fila com novas tentativas, guardada no banco de dados. Assim nada se perde se a internet cair.
- **Configuração:** dataset, token (guardado com `sealString`), WABA ID e page ID, mais o código de teste para o **Testar eventos**.
- **Registro:** cada envio é listado com o status, sem dados do cliente.
- **Na tela, honesto:** "a Meta casa os eventos pelo telefone; nem toda venda aparece no Gerenciador de Anúncios".

**LGPD:** enviar o telefone em hash para a Meta é compartilhar dado pessoal. É preciso:
- aviso na política da loja;
- a opção de não enviar quem pediu para não receber (sempre aplicada).
- A skill `lgpd` revisa isso.

**Validação antes de liberar:** um evento real de teste aparecendo no **Testar eventos**, com o dataset de um cliente. Se o caminho com telefone em hash não for aceito sem WABA, isso aparece aqui, antes de chegar ao cliente.

## 11. Planilha de leads com relatório por UTM

**Formato atual** (modelo `site-cliente-netlify/modelos/apps-script/Codigo.gs`):
- aba **Leads WhatsApp:** `Data/hora, Nome, Telefone, Interesse, utm_source, utm_medium, utm_campaign, utm_content, utm_term, Página`;
- aba **Orçamentos:** `Data/hora, Nome, E-mail, Telefone, Mensagem, utm_*, Página`.

**Novo:**

1. **No Apps Script (modelo da agência):** novo `doGet`, que exige a mesma senha (`SEGREDO_FORMULARIO`) e devolve as linhas novas desde uma data.
   - Nada fica público. Publicar a planilha como CSV exporia os leads: proibido pela LGPD.
   - Os clientes antigos recebem a atualização do script.

2. **No app:**
   - **Configuração:** em Configurações → Integrações → Planilha de leads, a loja informa a URL do script e a senha.
   - **Atualização:** a cada 30 minutos, ou no botão **Atualizar agora**.
   - **Guarda:** os leads ficam na tabela `leads` (v11), sem duplicar a mesma linha.

3. **Casamento pelo telefone** (normalizado com a regra de `people.ts`). Para cada lead, o app vê:
   - se virou conversa;
   - se virou contato;
   - em que etapa do funil está;
   - se virou venda e de quanto.

4. **Relatório por UTM** (no painel, função 12):
   - leads por `utm_source`, `utm_campaign` e `utm_content`;
   - para cada um: quantos conversaram, quantos compraram, faturamento e taxa de conversão;
   - filtro por período;
   - exportação em CSV.

5. **Opção:** colocar o lead novo como contato, com a etiqueta "Lead site" e um cartão na primeira coluna de um funil escolhido. O lead preencheu o formulário, então há consentimento.

6. **Bônus:** um lead que vira venda pode enviar `Purchase` à Meta (função 10), com a origem certa.

## 12. Painel: funil, faturamento e conversão

**Hoje:** a página **Vendas** (`src/renderer/src/pages/Vendas.tsx`) mostra faturamento, ticket, origem e motivos de perda.

**Novo:** a página **Painel** substitui Vendas, com filtro de período e de número.
- **Números do topo:** faturamento, vendas, ticket médio, conversas novas, taxa de conversão (conversas → vendas) e vendas recuperadas.
- **Funil:** escolhe-se o funil. Mostra quantos cartões há em cada coluna, a conversão de uma coluna para a seguinte e o tempo médio parado.
- **Faturamento no tempo:** por dia, semana ou mês.
- **De onde veio:**
  - campanha, lembrete, recuperação, anúncio, UTM (da planilha) e orgânico;
  - para cada origem: vendas, faturamento e conversão.
- **Motivos de perda** (já existe).
- Gráficos feitos com a skill `dataviz`, legíveis no tema claro e no escuro.

---

## 13. Módulos, planos e o site de licenças

As funções novas viram módulos que podem ser ligados e desligados.
- As chaves novas em `MODULE_KEYS` (`src/shared/types.ts:5`) e o plano de cada uma estão na tabela "Em que plano entra cada função", no fim deste roteiro.

**Repositório do site** (`Repositórios/nexu-chat-licencas`, Next.js + Supabase + Hotmart). Muda em toda onda que criar um módulo:
- **`src/lib/plans.ts`:** fica **igual** ao `PLANS` do app (regra do README do site), com o teste do site atualizado.
- **Página inicial e planos:** o que cada plano inclui, sem números ou depoimentos inventados.
- **`src/app/privacidade`:** deixa claro o que pode sair do computador:
  - texto para a IA na nuvem, anonimizado;
  - telefone em hash para a Meta;
  - leitura da planilha do Google.
- **`content/novidades/<versão>.md`:** uma por versão, no formato da `0.8.0.md`. O app mostra o resumo depois de atualizar.
- **Painel de licenças (`src/app/admin`):** confere se os módulos novos aparecem com nome legível.

**Ordem ao liberar:** publicar o site com os planos novos **antes** da versão nova do app. Assim, uma licença emitida pelo site já leva os módulos novos.

## Ordem de execução (ondas com agentes em paralelo)

Cada agente trabalha numa cópia separada do repositório (git worktree), com testes, e passa por revisão antes de juntar. Na mesma onda, as funções mexem em arquivos diferentes.

| Onda | Agentes em paralelo | Depende de |
|---|---|---|
| 1 | (a) Contexto do negócio + IA em um passo (1 e 2) · (b) Tela inicial (3) · (c) Funil com janela flutuante (4) · (d) Status (7) | nada |
| 2 | (a) Notas e datas do contato (5 e 6) · (b) Planilha de leads (11) · (c) Captura de anúncios (10A) | onda 1 (a janela da função 4 recebe as notas) |
| 3 | (a) Robô de atendimento (8) · (b) Painel (12) | 1, 5, 10A e 11 |
| 4 | (a) Recuperação de vendas (9) · (b) Envio à Meta por etapa (10B) | 8 e 10A |
| 5 | Auditoria de bugs com o Codex (somente leitura) + análise de desempenho + correções + manual | tudo |

**Auditoria final (pedido do Danilo):**
- Codex CLI em modo somente leitura no repositório inteiro, com o mesmo formato de `docs/AUDITORIA.md` (terceira rodada). Os achados são conferidos no código antes de corrigir.
- **Desempenho**, com medição antes e depois:
  - tempo de abertura;
  - memória com muitas conversas;
  - renderização da lista de conversas e mensagens (há virtualização?);
  - consultas do SQLite sem índice (`EXPLAIN QUERY PLAN` nas consultas do painel e dos lembretes);
  - timers simultâneos (`setInterval` de vários módulos);
  - custo do robô de IA por mensagem.

## Skills por etapa

| Etapa | Skills |
|---|---|
| Toda a execução | `subagent-driven-development`, `using-git-worktrees`, `test-driven-development`, `verification-before-completion`, `requesting-code-review` |
| Electron (IPC, processos, download do llama.cpp) | `electron-best-practices`, `code-security`, `security-best-practices` |
| Telas (início, janela do funil, assistente de IA, status, notas) | `impeccable` (já há `PRODUCT.md`), `emil-design-eng` para a janela flutuante |
| Painel | `dataviz` |
| IA (provedores, Claude de reserva) | `free-llm-apis`, `claude-api` |
| Meta e planilha | documentação oficial (seção 10); `site-cliente-netlify` (modelos `meta-capi.mjs` e `Codigo.gs`, que já fazem hash e normalização de telefone) |
| Perfil por IA, notas e envio à Meta | `lgpd` |
| Auditoria final | Codex CLI, `security-audit`, `systematic-debugging` |

Skills externas encontradas (`meta-capi`, `whatsapp-chatbot` etc.) têm poucas instalações e não foram verificadas. Não serão usadas sem aprovação.

## Decisões do Danilo (06/11/2026)

1. **Meta:** caminho do **telefone em hash**. O `ctwa_clid` é usado quando vier. A Cloud API fica fora deste roteiro.

2. **Robô de IA:**
   - **Conversas novas** são atendidas pela IA.
   - O atendente pode assumir a qualquer momento e depois **devolver para a IA** pelo botão.
   - Depois de um **tempo configurável sem o atendente responder** (padrão: 30 min), a IA **retoma sozinha**. A conversa mostra "IA retomou o atendimento".
   - A IA também **transfere para um atendente**:
     - Em Configurações há uma lista simples de atendentes, com nome e assuntos (ex.: "Ana: lentes de contato, financeiro").
     - Ao transferir, a IA escolhe o atendente pelo assunto. Sem lista, a conversa vai para "qualquer atendente".
     - O app notifica e coloca a conversa no filtro **"Esperando atendente"**.
     - A IA avisa o cliente ("vou chamar a Ana") e para de responder.
   - O app não tem login por atendente: a transferência é um aviso e um filtro, não uma permissão.

3. **Recuperação de vendas:**
   - **Por padrão, aprovar antes.** As mensagens vão para a fila **"Para aprovar"**, que mostra o texto da IA, a tentativa e o desconto. A mensagem sai com um clique, e dá para editar antes.
   - Em cada regra, a loja pode passar para envio automático.

4. **Planos:** classificação abaixo.

### Em que plano entra cada função

| Função | Módulo | Plano | Motivo |
|---|---|---|---|
| Tela inicial = Conversas (3) | nenhum (vale para todos) | Todos | É navegação, não é função vendida |
| Bloco de notas manual do cliente (5, sem IA) | `conversas` | Básico | Atendimento básico; quem tem só Conversas também precisa anotar |
| Aniversário e datas na ficha (6) | `conversas` (ficha) + `lembretes` (envio) | Básico (ver) / Marketing (enviar) | A ficha é de todos; o envio automático é dos lembretes, que já são Marketing |
| Funil com a conversa na janela (4) | `funil` | Marketing | Melhora um módulo que já é Marketing |
| Status agendado (7) | `status` (novo) | Marketing | Divulgação, igual a campanhas |
| Planilha de leads + relatório por UTM (11) | `leadsPlanilha` (novo) | Marketing | É o relatório de tráfego da agência. Tem tela própria de relatório |
| Meta: captura de anúncio + eventos por etapa (10) | `metaConversoes` (novo) | Marketing | Alimenta os anúncios. Usa as etapas do funil (Marketing); o `Purchase` usa o valor do cartão |
| Painel: funil, faturamento e conversão (12) | `vendas` | Completo | Substitui a página Vendas, que já é Completo |
| Contexto do negócio + IA em um passo (1 e 2) | `ia` | Completo | Base de toda a IA |
| Perfil do cliente pela IA (5, parte de IA) | `perfilIa` (novo) | Completo | Usa a IA; dá para desligar por causa da LGPD |
| Robô de atendimento com IA (8) | `iaAtendimento` (novo) | Completo | Usa a IA |
| Recuperação de vendas com desconto (9) | `recuperacao` (novo) | Completo | Usa a IA e o registro de vendas |

**Chaves novas em `MODULE_KEYS`:** `status`, `leadsPlanilha`, `metaConversoes`, `perfilIa`, `iaAtendimento` e `recuperacao`. Elas substituem a lista da seção 13.

**Regra de dependência na tela de Módulos:** `perfilIa`, `iaAtendimento` e `recuperacao` só ligam com `ia` ligado.
