# Desempenho — referência sintética de 12/11/2026

A medição identificou trabalho síncrono antes da janela abrir (~84 ms no reprocessamento de mensagens não suportadas), custo crescente na paginação por OFFSET e ~116 ms para calcular o painel de três contas. As primeiras páginas de conversas e mensagens ficaram abaixo de 1 ms na mediana. Esta entrega registra a referência; não altera o código do produto nem demonstra ganho antes/depois.

## Ambiente e método

- Apple M1, 8 núcleos, 8 GB; macOS/Darwin 27 arm64; Node 26.11.1 e SQLite 3.53.4.
- Coleta às 01h06 de 12/11/2026, horário de Brasília. Código-base `e5410c8` (`feat/onda7-desempenho`), que incorpora `e8c926f`; alterações desta entrega são só instrumentação e documentação. Recuperação e correções de provedores ainda não estavam integradas. Repetir após a integração para atualizar a referência.
- Dados exclusivamente sintéticos: 3 contas, 20.000 conversas, 500.000 mensagens, 30.418 contatos do WhatsApp, 5.000 pessoas, 3.000 negócios, 2.000 cartões e 5.000 leads. Banco final: 535,9 MiB. Gerador determinístico, com semente fixa e datas relativas ao dia da execução.
- Banco antigo criado com as 7 migrações de `b549c1f`; atualização para as 12 migrações da referência atual. Isso mede a atualização do esquema antigo, não o tempo do executável antigo.
- Funções reais do app executadas em Node/Vitest com Electron simulado. Banco em `/tmp/nexu-perf-20261112`; nenhum banco da loja, sessão WhatsApp, envio, transcrição ou provedor de IA foi utilizado.
- Tempos de parede por operação; mediana e percentil 95 pelo posto mais próximo. Normalmente 3 aquecimentos e 30 amostras; exceções abaixo. Cache de disco não foi limpo. Outros processos podem influenciar os resultados; não é um teste de latência em máquina ociosa.
- Resultados completos, incluindo mínimos, máximos e SQL: [banco e migrações](desempenho/2026-11-12/01-banco-e-migracoes.json) e [consultas e memória](desempenho/2026-11-12/02-consultas.json). `codigoBase` nos JSON é o HEAD anterior à instrumentação, não uma alegação de árvore limpa.

## Abertura e trabalho inicial

| Operação                                           | Mediana (ms) | p95 (ms) |   N |
| -------------------------------------------------- | -----------: | -------: | --: |
| Banco vazio: criar e aplicar todas as migrações    |        5,311 |    6,917 |  30 |
| Banco vazio atual: reabrir                         |        0,687 |    0,806 |  30 |
| Banco vazio antigo: migrar para atual              |        1,377 |    2,469 |  30 |
| Banco grande antigo: abrir e migrar                |        2,051 |    2,336 |   5 |
| Banco grande atual: abrir                          |        0,689 |    1,117 |  10 |
| Reprocessar mensagens não suportadas, banco grande |       84,172 |   91,161 |  10 |

A primeira passagem do reprocessamento levou 90,58 ms. `src/main/index.ts` chama `reparseUnsupported` de forma síncrona antes de abrir a janela; portanto esse trabalho entra no caminho de abertura. A consulta busca até 5.000 mensagens `unsupported` com conteúdo bruto; não se deve extrapolar o resultado para todo histórico real.

**Tempo completo até a janela ficar utilizável não foi medido.** Ele inclui bootstrap do Electron, preload, renderer, React, arquivos, IPC e reconexão; somar os tempos desta tabela não representa esse tempo.

O reprocessamento de anúncios percorreu 240.163 mensagens candidatas em 481 lotes, achando 1.368 conversas. Por lote: mediana 1,768 ms, p95 3,541 ms, máximo 168,892 ms. O total medido dentro das chamadas foi 1,2 s (inclui espera e logs, não é medição de CPU). O nome histórico `cpuTotalSegundos` do JSON representa esse tempo de parede. A estimativa com 200 ms de intervalo por lote é 97,4 s, sem contar o atraso inicial de 3 s; **não** foi uma espera real cronometrada de 97 s nem um bloqueio contínuo da interface.

## Consultas, índices e paginação

| Operação real                                           | Mediana (ms) | p95 (ms) |   N |
| ------------------------------------------------------- | -----------: | -------: | --: |
| Primeiras 80 conversas                                  |        0,414 |    1,222 |  30 |
| 80 conversas com OFFSET 8.000                           |       16,151 |   20,089 |  30 |
| Busca de conversas por “Maria”, até 80                  |        8,256 |   11,262 |  30 |
| Últimas 60 mensagens da maior conversa individual       |        0,292 |    0,471 |  30 |
| Painel de 30 dias, três contas e um funil               |      115,503 |  180,109 |  30 |
| Destinatários de três regras de lembrete da conta maior |        7,047 |    8,067 |  30 |

Os tempos incluem consulta e transformação do resultado em objetos, mas não transporte IPC ou renderização. Os lembretes medem `dueToday`, sem gerar campanhas ou disparar mensagens. O custo do painel é relevante porque suas consultas rodam no processo principal de forma síncrona.

O gravador registra o SQL executado e o plano estrutural de `EXPLAIN QUERY PLAN` com os placeholders sem os valores originais. Os planos não são perfis de linhas efetivamente visitadas; parâmetros e distribuição real podem mudar a escolha do otimizador.

- Painel: os acessos principais usam `messages_chat_ts`, `chats_recent`, `deals_account`, `deals_chat`, `leads_phone` e chaves de `lid_map`, cartões e etapas. Há B-trees temporárias para agrupamento/ordenação. A varredura virtual `json_each` é parte do desenho de consulta em lote e não prova falta de índice numa tabela persistente.
- Lembretes: seleção de pessoas por `people_jid`; etiquetas e registro de envio por seus índices. Ainda é necessário materializar as pessoas elegíveis da conta e conferir suas datas em JavaScript. O resultado não elimina a necessidade de medir contas maiores.
- OFFSET 8.000 ficou cerca de 39 vezes mais lento que a primeira página. Uma futura paginação por cursor precisa preservar a ordenação por fixação e data e o comportamento dos filtros; não foi implementada aqui.

Nenhum índice novo foi adicionado com base apenas em uma marcação `SCAN` ou `TEMP B-TREE`.

## Memória e listas da interface

Snapshots do processo **Node/Vitest**, em MiB, sem coleta de lixo forçada:

| Momento                                                    |   RSS | Heap usado |
| ---------------------------------------------------------- | ----: | ---------: |
| Antes de abrir banco                                       |  82,0 |       26,8 |
| Banco aberto, antes das consultas                          |  82,0 |       26,8 |
| Depois das repetições de consultas, antes de reter a lista | 311,5 |      149,2 |
| 11.639 conversas retidas em objetos                        | 312,5 |      166,7 |
| Também 2.341 mensagens da maior conversa individual        | 312,5 |      170,4 |

O crescimento inclui alocações anteriores dos benchmarks, cache SQLite e funcionamento do GC; **não** é consumo isolado das listas, pico, vazamento ou memória do app Electron. Fechar o banco não mede memória ociosa do app. É preciso medir os processos principal/renderer/GPU do aplicativo e aguardar estabilização para responder isso.

Inspeção do código (`ChatList.tsx`, `ChatView.tsx`, `chatStoreCore.ts`): a lista usa páginas de 80 conversas e o histórico páginas de 60 mensagens; as páginas acumulam em memória. Ambos renderizam os itens carregados com `map`, sem virtualização. A busca tem atraso de 180 ms. Há risco de crescimento do DOM e do custo de reconciliação ao percorrer muitas páginas. **FPS, duração de renderização e travamentos de rolagem não foram medidos**; este relatório não atribui um número a esse risco.

## Agendadores e robô de IA

Inspeção estática dos intervalos, sem simular ocioso nem carga concorrente:

| Rotina                                                                 | Intervalo recorrente                 |
| ---------------------------------------------------------------------- | ------------------------------------ |
| Campanhas (`engine.ts`)                                                | 1 min, além do timer por conta       |
| Retomada/limpeza do robô (`iaAtendimento.ts`)                          | 1 min, além do debounce por conversa |
| Status: fila / limpeza de mídia                                        | 30 s / 1 h                           |
| Lembretes                                                              | 15 min                               |
| Mapeamento automático de perfil                                        | 10 min                               |
| Sincronização da planilha / backup                                     | 30 min / 30 min                      |
| Limpeza de automações / versão WhatsApp / licença / atualização do app | 6 h cada                             |

Há também timers de reconexão, digitação, envio, sincronização, debounce e descarregamento do modelo local. Esses intervalos não são uma contagem exata de timers simultâneos: depende dos módulos, contas e conversas ativas. Alguns callbacks síncronos consultam o SQLite na mesma thread; alinhamento dos timers merece teste de carga. Não há medição de CPU ociosa ou sobreposição nesta referência. A recuperação adicionará seus próprios agendadores quando integrada.

O robô consulta as últimas 20 mensagens e envia até 15 no histórico do prompt, com `tier: smart` e saída limitada a 500 tokens (`respondInner` em `iaAtendimento.ts`). A chamada de `complete` pode tentar provedores de reserva; 500 limita a saída de cada tentativa, não o total de entrada ou o número de requisições. O roteador registra requisições, erros e tokens informados pelo provedor em `ai_usage`.

**Custo por mensagem, latência de inferência e memória do modelo local não foram medidos.** Nenhuma API foi chamada. Não há estimativa monetária confiável sem modelo, provedor, tokens de entrada/saída e tentativas reais. Para medir depois: capturar os contadores antes/depois de uma conversa sintética, latência por etapa e RSS do processo do modelo, com provedor gratuito ou motor local.

## Reprodução

Na raiz do worktree/repositório, com as dependências instaladas, execute os comandos **em sequência**. A etapa 01 recria os arquivos de banco sintético da pasta indicada; use uma pasta exclusiva fora dos dados do app. Reserve espaço para bancos temporários, aproximadamente 2 GB durante a execução.

```sh
NEXU_PERF_DIR=/tmp/nexu-perf-20261112 npx vitest run --config scripts/perf/vitest.perf.config.ts scripts/perf/01-banco-e-migracoes.perf.ts
NEXU_PERF_DIR=/tmp/nexu-perf-20261112 npx vitest run --config scripts/perf/vitest.perf.config.ts scripts/perf/02-consultas.perf.ts
npx eslint scripts/perf
```

Os JSON ficam em `$NEXU_PERF_DIR/resultados/`. A etapa 02 depende do banco já concluído pela 01; não dispare os dois processos em paralelo. São medições manuais fora da suíte normal e não estabelecem limites rígidos de CI. Rodadas desta entrega passaram em 5/5 e 4/4 verificações, respectivamente. Não houve otimização do produto nesta entrega.

Para concluir a avaliação completa do roteiro, faltam: tempo até a janela utilizável no app empacotado, memória total e ociosa do Electron com muitas conversas, renderização/rolagem real, carga concorrente dos timers e inferência/custo de IA. Repetir a referência após integrar recuperação e provedores, mantendo o mesmo cenário e ambiente para qualquer comparação antes/depois.
