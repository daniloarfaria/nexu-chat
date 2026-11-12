# Impressão de imagens e PDF nas conversas

Escopo confirmado: somente imagens/PDF das conversas.

- Ação `Imprimir` junto às ações de cada mensagem compatível, com bloqueio de clique enquanto prepara/imprime.
- IPC `media:print` recebe somente `accountId`, `jid` e `id`; valida conta e mensagem, carrega mídia por `ensureMedia` e confere arquivo real dentro da pasta daquela conta. Sem paths/URLs enviados pelo renderer.
- Rejeitar mensagens apagadas, visualização única, formatos ativos e arquivos acima de 64 MB. Imagens são decodificadas e reencodificadas em PNG antes de compor HTML estático.
- PDF usa o arquivo original no viewer Chromium, com espera por carregamento concluído; preservar páginas/fontes/vetores. Electron 44 inclui a correção upstream [#47377](https://github.com/electron/electron/pull/47377), disponível desde Electron 35.6/36.5. Não usar `printToPDF` para impressão de PDF existente.
- Janela sem preload/Node, sandbox e contextIsolation ativos, sessão efêmera, permissões/popups/navegação bloqueados. Só arquivo autorizado, dados da imagem e recursos internos do viewer podem carregar; nenhuma requisição remota permitida.
- `webContents.print({ silent: false })` mantém diálogo do sistema e escolha da impressora. Cancelamento é resultado normal. Sucesso, cancelamento e erro limpam a janela e sessão; chamadas concorrentes da mesma mensagem compartilham uma operação.

Validação: 21 testes unitários, typecheck e ESLint. E2E `tests/e2e/media-print.mjs` cria perfil temporário e fixtures sintéticas; intercepta `webContents.print` antes das ações, verifica viewer PDF carregado, imagem, `silent:false` e fechamento ao cancelar. Nenhuma impressão física ou envio ao WhatsApp.

A espera do PDF consulta o estado do viewer Chromium incluído no Electron 44; atualizar Electron requer manter o smoke E2E para detectar mudança nessa interface interna.
