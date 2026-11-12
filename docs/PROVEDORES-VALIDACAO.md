# Validação dos provedores NVIDIA e DeepSeek

Conferência da retomada em 12/11/2026, na branch `feat/onda6-provedor-nvidia-fix`, sobre `b5d5f63`.

## Modelos conferidos em fontes oficiais

| Provedor | Identificadores configurados | Fonte |
| --- | --- | --- |
| NVIDIA | `nvidia/nemotron-3.5-lightning-30b-a3b` nos dois níveis | [Página oficial do modelo](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard), com [referência da API](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-lightning-30b-a3b) |
| DeepSeek | `deepseek-flash` no rápido e `deepseek-v4-pro` no caprichado | [Modelos e preços da API](https://api-docs.deepseek.com/quick_start/pricing/) |

Os nomes configurados já correspondiam aos publicados. A documentação da DeepSeek confirma a base OpenAI `https://api.deepseek.com`; a página da NVIDIA informa faixa gratuita para prototipagem, com limites por modelo/conta. Isso não garante disponibilidade futura: os nomes continuam editáveis e o teste de conexão explica erros de modelo, chave, limite e conexão.

As páginas foram lidas sem credenciais. Não houve chamada real de inferência, uso de chave paga nem teste de disponibilidade de uma conta específica.

## Correções preservadas da execução anterior

- Transcrição na Groq respeita a proibição de conversas de clientes, o modo Estrita e a indicação de treinamento. Usa Whisper local quando disponível ou explica o bloqueio.
- NVIDIA e DeepSeek entram sem uso em conversas de clientes; o dono pode ligar o interruptor no cadastro e no assistente Configurar IA. A migração acrescentada também desliga esse uso nos cadastros anteriores desses dois provedores.
- Cada provedor pago tem contador e limite mensal próprios. A ordem premium mantém os filtros de privacidade.
- Ollama e motor local aceitam apenas loopback. Provedor personalizado exibe aviso e interruptor de uso com clientes.
- Chamadas OpenAI e transcrição rejeitam redirecionamentos; erros inesperados não exibem o texto cru recebido. NVIDIA e DeepSeek permanecem marcados como provedores que podem treinar com dados, mesmo com pedido de alteração pelo IPC.
- O limite por minuto pode ser editado; o manual descreve os limites, a privacidade, a transcrição e o cadastro da chave do próprio usuário.
- A regressão em `tests/ai-privacidade.test.ts` verifica que os módulos não chamam APIs de texto fora do roteador. A integração de recuperação precisa manter `customerData: true` em suas chamadas.

## Verificação executada

- `npm test`: 557 testes passaram em 38 arquivos.
- `npm run typecheck`: passou para processo principal e interface.
- `npm run lint`: passou sem avisos ou erros.

A retomada encontrou o worktree limpo: as telas pendentes já estavam no commit `6bbeeba`, além das proteções em `b0e0521`, ambas incluídas no merge `b5d5f63`. Esta conferência não exigiu alterar o código dessas funções.

## Integração

Ao juntar esta branch com recuperação de vendas, preservar as migrações já existentes e acrescentar as novas no fim. O teste de migração dos provedores deve continuar partindo da versão imediatamente anterior à criação de `monthly_limit`; ele não deve confundir uma migração posterior de outra função com a migração sob teste. Executar novamente a suíte na branch integrada.
