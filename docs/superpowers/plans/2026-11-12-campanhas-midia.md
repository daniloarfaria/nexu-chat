# Campanhas: mídia e gravação por versão

Pedido confirmado: cada versão possui seu texto e mídia próprios, com prévia real e gravação de voz antes de salvar/testar.

- Preservar `templates: string[]`; nova coluna JSON `template_media` usa o mesmo índice. `NULL` mantém fallback de campanhas antigas em `media` global; um item `null` representa versão sem anexo.
- `campaigns:save`: `mediaIndices` aponta para índices anteriores preservados; `files` contém uploads novos por índice. Nunca receber caminhos do renderer. Validar/mapear/converter todos antes de escrever. Atualizar texto+mídia em transação e remover arquivos antigos apenas após sucesso.
- `campaigns:media`: `variantIndex` opcional preserva compatibilidade; gravação usa `voice` e remux WebM/Opus→Ogg/Opus existente. Upload de áudio comum permanece intacto.
- `campaigns:media-preview`: recebe conta+campanha+índice, devolve bytes com limite de 64 MB; valida pertencimento à conta e caminho interno. Renderer cria/revoga object URLs.
- Motor sorteia um índice uma única vez e usa texto+mídia desse índice; voz recebe `ptt`. Teste no próprio número mantém mesma associação e valida todas as versões antes do primeiro envio.
- Duplicação copia anexos fisicamente; excluir original preserva cópia.
- Editor usa identidade estável por versão para remover texto+anexo juntos. Recorder cancela/libera microfone em cancelamento e desmontagem; áudio concluído é ouvido/removido no preview antes de salvar.

Verificação: testes de variantes, IPC de teste, motor real e typecheck. Coordenador executa E2E em perfil temporário sem mensagens reais e suíte/build final.
