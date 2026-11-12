# Instruções do projeto Nexu Chat

## Uso de modelos (economizar tokens)

Alterne entre os modelos disponíveis. Use o mais barato que dê conta da tarefa.

| Tarefa | Quem faz |
|---|---|
| Buscar, listar, mover, conferir arquivos, rodar comandos repetitivos | agente `rapido` (Haiku) |
| Executar plano definido: código, testes, docs, ajustes | agente `executor` (Sonnet) |
| Auditoria e segunda opinião de código | agente `auditor-codex` (Codex, cota OpenAI) |
| Ler ou resumir material enorme (repositório, PDFs, pastas) e pesquisa na web | agente `leitor-gemini` (Gemini, cota Google) |
| Planejar, decidir arquitetura, revisar o que os agentes entregaram | coordenador (Opus) |
| Problema muito difícil em que os outros falharam | `model: fable`, só sob demanda |

Regras:
- Tarefa de 1 a 3 comandos: faça direto, sem agente.
- Partes independentes: agentes em paralelo. Confira o resultado antes de relatar.
- Passe aos agentes só o contexto necessário, apontando os arquivos em vez de colar o conteúdo.
- Não use APIs pagas. Nunca exponha credenciais nem leia a chave privada de licença.
