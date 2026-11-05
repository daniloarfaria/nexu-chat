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
