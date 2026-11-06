# Nexu Chat

> Antes chamado Disparador. O nome interno (pasta de dados, Keychain, `appId`) continua `disparador` de propósito: trocar faria os clientes perderem a sessão do WhatsApp ao atualizar.

App desktop para **Mac e Windows** que permite a pequenos negócios (óticas e outros) atender, fazer campanhas e gerir grupos pelo WhatsApp. Tem proteção contra bloqueio, banco de dados local e backup criptografado.

- **Auditoria de segurança e bugs (fase 9):** [docs/AUDITORIA.md](docs/AUDITORIA.md)
- **Licenciamento (interno):** [docs/LICENCIAMENTO.md](docs/LICENCIAMENTO.md) · `node scripts/licenca.mjs`
- **Manual do usuário:** [docs/MANUAL.md](docs/MANUAL.md). Atualize a cada função nova.
- Especificação completa e fases: [docs/ESPECIFICACAO.md](docs/ESPECIFICACAO.md)
- Contexto de produto (para design): [PRODUCT.md](PRODUCT.md)
- Bot antigo, só como referência: [legacy/](legacy/). Sessão, planilhas e logs dele não vão para o git.

## Stack

O app é feito em Electron 44 com electron-vite, e a interface em React 19, TypeScript e Tailwind 4. A conexão com o WhatsApp usa o [Baileys](https://github.com/WhiskeySockets/Baileys) 7 (WebSocket, sem Chrome).

Os dados ficam no SQLite embutido do Node (`node:sqlite`, sem módulo nativo). A sessão do WhatsApp é guardada criptografada com o `safeStorage`, que usa o Keychain no Mac e o DPAPI no Windows.

## Comandos

```bash
npm install          # instala e aplica patches/ (patch-package)
npm run dev          # abre o app em modo desenvolvimento
npm test             # testes (Vitest): backup, conversas, voz, regras, campanhas e motor, automações, grupos, lembretes, vendas, IA
npm run typecheck && npm run lint
npm run build:mac    # gera .dmg (arm64 e x64) em dist/
```

O `.exe` de Windows é gerado pelo GitHub Actions (Actions → Build → *Run workflow*). O makensis não roda nativo em Mac Apple Silicon.

> O app instalado tem os fusíveis do Electron (sem RunAsNode/inspetor). Testes de interface com Playwright (`tests/e2e`) rodam na versão não empacotada.

> Rodando pelo terminal do VS Code: o VS Code define `ELECTRON_RUN_AS_NODE=1`. Use `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Pontos importantes

- **Versão do WhatsApp Web:** o app busca a mais recente na [WPPConnect](https://wppconnect.io/pt-BR/whatsapp-versions/) ao abrir e a cada 6 h ([src/main/wa/version.ts](src/main/wa/version.ts)). Se não conseguir, tenta o próprio WhatsApp Web e depois a última que funcionou.
- **Patch do Baileys** ([patches/](patches/)): a rc14 do npm se identifica como `WIN32`, que o servidor recusa com o erro 428 antes de mostrar o QR. O patch aplica a correção do PR #2741 (`WIN_HYBRID`). Ele pode ser removido quando sair uma versão nova do Baileys com essa correção.
- **Identidade do navegador:** `Browsers.windows('Desktop')`, a única que hoje permite pedir o histórico completo (veja a issue #2880 do Baileys).
- **Atualização do app:** o app verifica ao abrir e a cada 6 h, e o usuário escolhe quando baixar. No Windows, baixa e instala sozinho. No Mac sem assinatura da Apple, abre a página do novo `.dmg`. As versões são publicadas no repositório público `daniloarfaria/nexu-chat-releases` ao criar uma tag `vX.Y.Z`, o que exige o segredo `RELEASES_TOKEN`.
- **Mac sem notarização:** na primeira vez, é preciso abrir com clique direito → Abrir.
- **IA:** provedores gratuitos (formato OpenAI) com troca automática por limite; Claude como reserva paga via SDK oficial (`@anthropic-ai/sdk`, `claude-opus-5-5` por padrão, fallback de recusa ligado). Conversas anonimizadas antes de sair do computador ([src/main/ai/](src/main/ai/)). IA no computador: `llama-server` (llama.cpp, versão fixa) e modelo GGUF baixados sob demanda para `userData/ai-local/`, com SHA-256 fixo em [src/main/ai/local/catalog.ts](src/main/ai/local/catalog.ts); medição com `node scripts/medir-ia-local.mjs`.
- **Planilhas:** SheetJS 0.20.3 do CDN oficial (a versão do npm tem falhas conhecidas).
- **Dados:** ficam na pasta de dados do app (Configurações → Sistema → Abrir pasta). O backup gera um arquivo `.dspbak` (AES-256-GCM, chave derivada da senha com scrypt).
