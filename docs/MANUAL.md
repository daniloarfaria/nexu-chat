# Manual do Nexu Chat

> Versão do app: 0.8.1 · Atualizado em 05/11/2026

O Nexu Chat conecta o WhatsApp da sua loja ao computador. Com ele você atende os clientes, guarda todas as conversas no computador e, nas próximas versões, também envia campanhas, gerencia grupos e acompanha as vendas.

---

## 1. Instalação

### Mac
1. Abra o arquivo `Nexu-Chat-…-mac-arm64.dmg` (Macs com chip Apple, M1 ou mais novos) ou `…-mac-x64.dmg` (Macs Intel).
2. Arraste o Nexu Chat para a pasta **Aplicativos**.
3. **Na primeira vez**, clique com o botão direito no Nexu Chat e escolha **Abrir**. Depois confirme em **Abrir**. Isso só é preciso uma vez, porque o app ainda não tem a assinatura paga da Apple.

### Windows
1. Abra o arquivo `Nexu-Chat-…-windows-setup.exe`.
2. Se aparecer "O Windows protegeu o computador", clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Siga o instalador. O atalho fica na Área de Trabalho e no Menu Iniciar.

> Desinstalar o app **não apaga** suas conversas nem a conexão do WhatsApp. Para levar tudo para outro computador, use o **backup** (seção 13).

---

## Licença
Em **Configurações → Licença**, cole a chave enviada pela agência e clique em **Ativar**. Não precisa de internet.
- A tela mostra o plano, os módulos liberados, quantos números de WhatsApp e até quando vale.
- Perto de vencer, aparece um aviso no topo. Depois do vencimento, os módulos continuam funcionando por mais 7 dias.
- Sem licença ou com ela vencida, o app continua mostrando as conversas, e seus dados nunca ficam presos.
- Para renovar ou mudar de plano, cole a chave nova por cima da antiga.

## 2. Conectar o WhatsApp

1. Abra o menu **Contas** (ou clique em **Adicionar conta**, no alto à esquerda).
2. Clique em **Nova conta**, dê um nome (ex.: "Ótica Centro") e escolha uma cor.
3. Clique em **Criar e conectar**. Aparece um QR Code.
4. No celular da loja, abra o WhatsApp → **Configurações** (ou os três pontinhos) → **Aparelhos conectados** → **Conectar um aparelho** e aponte a câmera para o QR Code.

**Sem câmera?** Use a aba **Código pelo número**: digite o número da loja com DDD, clique em **Gerar código** e, no celular, escolha **Conectar com número de telefone** e digite o código que apareceu no app.

### O que significa cada status
| Status | Significado |
|---|---|
| **Conectado** | Tudo certo: o app recebe e envia mensagens. |
| **Conectando** | O app está ligando ou voltando depois de uma queda de internet. Ele tenta de novo sozinho. |
| **Aguardando leitura** | O QR Code está na tela esperando o celular. |
| **Desconectado** | A conexão foi pausada. Clique em **Conectar**. |
| **Sem sessão** | O WhatsApp foi desconectado pelo celular. É preciso ler o QR Code de novo. |

### Botões da conta
- **Conectar ao abrir**: liga sozinho quando você abre o app (recomendado).
- **Reimportar histórico**: desvincula e vincula de novo para trazer as conversas antigas (veja a seção 3).
- **Sair**: desvincula este computador do WhatsApp. As conversas salvas continuam no app.
- **Lixeira**: exclui a conta e **todos** os dados dela deste computador.

### Várias lojas no mesmo app
Crie uma conta para cada número. Para trocar de loja, use o seletor no alto do menu, à esquerda. Cada conta tem suas próprias conversas e configurações.

---

## 3. Conversas

O menu **Conversas** funciona como o WhatsApp do computador, mas tudo fica **salvo no seu computador**, mesmo o que for apagado do celular.

**Conversas é a tela que abre quando você inicia o app.** Se ainda não houver número conectado, ela mostra "Conecte seu WhatsApp" com um botão que leva direto a **Contas**. O resumo que antes ficava na tela Início (números conectados, último backup e versão do WhatsApp Web) agora está em **Configurações → Visão geral**.

### Histórico
- O WhatsApp só envia o histórico de conversas antigas **no momento em que o aparelho é vinculado**. Enquanto isso acontece, aparece no alto da lista o aviso "Sincronizando histórico…", com a contagem de mensagens.
- Quanto tempo de histórico vem depende do celular. Normalmente são meses.
- Para trazer o histórico de novo, use **Contas → Reimportar histórico**. Nada do que já está salvo é apagado e nada fica duplicado.
- Com o app fechado, o celular continua recebendo normalmente. Quando você abrir o app, o que chegou nesse meio-tempo é baixado.

### Fotos de perfil
As fotos dos contatos e dos grupos aparecem na lista, no topo da conversa e, nos grupos, ao lado das mensagens de cada participante, como no WhatsApp.
- O app busca as fotos aos poucos, só das conversas que estão na tela, e guarda no computador por 24 h.
- Quem esconde a foto (privacidade) aparece com as iniciais.

### Lista de conversas
- **Buscar conversa**: procura por nome ou número. Não precisa digitar acentos ("joao" encontra "João").
- **Filtros**: Todas, Não lidas, Grupos e Arquivadas. Com o robô de atendimento ligado, aparece também **Esperando atendente** (veja "Robô de atendimento com IA", logo depois de Respostas automáticas).
- **Nova conversa** (ícone de balão com +): digite DDD e número para falar com alguém que ainda não está na lista.
- O número ao lado de **Conversas** no menu mostra quantas mensagens não lidas existem.

### Dentro de uma conversa
- **Enter** envia. **Shift + Enter** pula linha.
- Use \*negrito\*, \_itálico\_ e \~tachado\~ como no WhatsApp.
- Passe o mouse sobre uma mensagem para:
  - **Reagir** com um emoji;
  - **Responder** citando a mensagem;
  - **Editar** uma mensagem sua (até 15 minutos depois do envio, regra do WhatsApp);
  - **Apagar para todos** uma mensagem sua.
- Clique numa citação para pular até a mensagem original.
- **Buscar nas mensagens** (lupa no alto à direita): procura dentro de todas as conversas.
- **Notas do cliente:** na faixa abaixo do nome (onde ficam as etiquetas), o botão **notas** abre o bloco de notas daquele cliente (veja "Notas do cliente" na seção 5).

### Enviar arquivos e outros conteúdos
Clique no **clipe** ao lado da caixa de texto:

| Opção | O que faz |
|---|---|
| Fotos e vídeos | Envia imagens e vídeos. O que você escrever na caixa vira a legenda. |
| Documento | Envia qualquer arquivo (PDF, planilha, foto sem compressão…). Até 100 MB. |
| Localização | Cole as coordenadas do Google Maps (ex.: `-23.5505, -46.6333`) e o nome do local. |
| Contato | Envia um cartão de contato com nome e telefone. |
| Enquete | Pergunta com até 12 opções, com uma ou várias respostas. |

Atalhos:
- **Arrastar** arquivos para a conversa anexa os arquivos.
- **Colar** (Cmd+V / Ctrl+V) uma imagem copiada anexa a imagem.
- Marque **Enviar como documento** para mandar fotos sem perder qualidade.

### Mensagem de voz
1. Clique no **microfone** (aparece quando a caixa de texto está vazia).
2. Na primeira vez, o computador pede permissão para usar o microfone. Aceite.
3. Fale. Clique em **enviar** para mandar ou em **Descartar** para cancelar.

### Mídias recebidas
- Fotos, figurinhas e áudios leves são baixados sozinhos quando chegam.
- Vídeos, documentos e mídias do histórico mostram o botão **Baixar**. Clique para abrir.
- Clique em uma foto para ampliar. Clique em um documento para salvar no computador.
- Mensagens de **visualização única** só podem ser abertas no celular.

### Transcrição de áudios
Embaixo de cada áudio ou mensagem de voz aparece **Transcrever**. O texto fica salvo na conversa, entra na busca e é usado pela IA nas sugestões de resposta e no playbook.
- Em **Configurações → Transcrição de áudio** você escolhe:
  - **quando:** pelo botão, automático para toda mensagem de voz recebida, ou desligado;
  - **onde:** no computador ou na Groq.
- **No computador (Whisper):** o áudio não sai daqui. O app encontra sozinho o whisper-cli, o modelo e o ffmpeg; se não achar, use **Escolher**.
- **Na Groq:** gratuito e não treina com os dados. Usa a mesma chave da Groq cadastrada no Assistente de IA.

### Notificações
Quando chega mensagem e você não está olhando aquela conversa, aparece uma notificação. Clique nela para abrir a conversa. Conversas silenciadas ou arquivadas não notificam.

---

## 4. Módulos

Em **Configurações → Módulos** você liga e desliga as funções de cada conta. O menu mostra só o que está ligado, e assim o app fica simples para quem usa pouco.

| Módulo | Para que serve |
|---|---|
| Conversas | Atender pelo computador (seção 3) |
| Contatos (sempre ligado) | Base de clientes para campanhas e lembretes (seção 5) |
| Campanhas e Proteção anti-bloqueio | Enviar promoções para a base de clientes (seções 6 e 7) |
| Respostas automáticas | Responder sozinho por palavra-chave, fora do horário e boas-vindas (seção 8) |
| Grupos (envio, extrair membros, criar, moderação) | Cada função liga separada (seção 9) |
| Lembretes | Aniversário, pós-venda, revisão anual (seção 10) |
| Status do WhatsApp | Postar texto, foto ou vídeo no status, agora ou agendado (seção "Status", logo depois de Lembretes). Vem desligado; faz parte do plano Marketing |
| Anúncios da Meta | Mostra quais conversas vieram de anúncio de clique para o WhatsApp (seção "Anúncios da Meta", depois de Vendas). Vem desligado; faz parte do plano Marketing |
| Vendas | Marcar o que virou venda e ver o retorno no Painel (seção 11) |
| Assistente de IA | Sugestões de resposta, versões de campanha e playbook (seção 12) |
| Planilha de leads (plano Marketing) | Traz os leads do formulário do site e mostra o resultado por origem do anúncio (seção 11, “Leads do site”) |
| Robô de atendimento com IA | A IA responde as conversas novas e passa para uma pessoa quando precisa (seção "Robô de atendimento com IA", depois de Respostas automáticas). Vem desligado; é do plano Completo e só liga com o Assistente de IA ligado |
| Recuperação de vendas | A IA chama de volta o cliente que sumiu depois do orçamento, com até 3 mensagens e um desconto que só você define (aba **Recuperar vendas** em Automações, seção "Recuperar vendas com desconto"). Vem desligado; é do plano Completo e só liga com o Assistente de IA ligado |
| Perfil do cliente pela IA | Botão **Mapear perfil** e o mapeamento automático das notas do cliente (seção 5). Vem desligado; é do plano Completo e só liga com o Assistente de IA ligado. Ligar autoriza enviar trechos anonimizados das conversas à IA em segundo plano, sem clique. Dá para desligar a qualquer momento por causa da LGPD |

---

## 5. Contatos

O menu **Contatos** é a base de clientes da loja, usada por campanhas e lembretes.

- **Importar planilha:** escolha o arquivo (Excel, CSV ou LibreOffice) e confira as colunas que o app sugeriu: telefone, nome e aniversário.
  - Marque também outras colunas que quiser guardar, como cidade e data_compra. Elas viram variáveis nas mensagens: `{cidade}`, `{data_compra}`.
  - Dá para colocar etiquetas em todos de uma vez, como "Clientes 2026".
  - Telefones são padronizados sozinhos, com DDD e 55.
  - Números repetidos e inválidos são ignorados e mostrados no resumo.
  - Importar de novo **atualiza** quem já existe, nunca duplica.
- **Etiquetas:** selecione contatos e aplique ou remova etiquetas. É assim que você escolhe o público das campanhas.
  - O botão **Etiquetas** abre a lista com cor, descrição e quantos contatos têm cada uma. Lá você cria, muda a cor, renomeia ou apaga.
  - Renomear uma etiqueta para o nome de outra **junta as duas**.
  - Renomear ou apagar também atualiza as colunas de funil, os lembretes e as campanhas ainda não enviadas.
  - "VIP" e "vip" são a mesma etiqueta.
  - Na ficha do contato, digite para buscar uma etiqueta; **Enter** cria uma nova.
- **Adicionar ao funil:** com contatos selecionados, coloque todos de uma vez numa coluna de funil.
- **Não receber:** quem responde **SAIR** (ou "parar", "não quero mais"…) entra sozinho nessa lista e recebe uma confirmação. Você também pode marcar à mão.
- **Excluir** atende pedidos de exclusão de dados (LGPD). Apaga o contato junto com as conversas, mensagens, fotos e arquivos recebidos e as vendas registradas. A exclusão vale para todas as formas do número (com e sem o nono dígito e o identificador interno do WhatsApp) e também apaga os leads da planilha, a origem de anúncio, o modo do robô e o registro de respostas da IA dessa pessoa, além de tirá-la da fila de contatos a criar (para o contato não voltar sozinho). Se a pessoa tinha pedido para não receber, só o número fica guardado na lista de bloqueio, para ela nunca mais receber, mesmo se voltar numa planilha.
- **Exportar** gera um CSV com todos os contatos.
- **Aniversário e datas do contato:** na ficha, o campo **Aniversário** mostra a idade (quando há o ano) e quantos dias faltam. Nos campos de data que você criar (por exemplo `data_compra`), aparece ao lado quando a data volta.
  - A ficha lista os **Lembretes enviados**, uma linha por envio, como "Lembrete de aniversário enviado em 12/03/2027". Um lembrete que ainda não foi confirmado como enviado aparece como "programado" só nas primeiras 12 horas; depois, se não saiu, some.
  - Se o cliente disser a data na conversa ("meu aniversário é dia 12/03", "nasci em..."), o app pergunta **"Salvar 12/03 como aniversário?"** no bloco de notas. **Nada é salvo sem o seu clique** em **Salvar aniversário**; **Agora não** esconde a sugestão para sempre. A sugestão só aparece para quem ainda não tem aniversário e só vale quando o **próprio cliente** fala da sua data ("nasci em", "meu aniversário é", "faço anos") com a data logo depois; aniversário de marido, filho ou outra pessoa é ignorado. Ao salvar, o campo Aniversário da ficha se atualiza.
  - Enviar os lembretes continua na seção 10 (módulo Lembretes, plano Marketing). Ver e editar as datas na ficha vale para todos os planos.

### Notas do cliente

Cada cliente tem um bloco com **quantas notas você quiser**, para lembrar de gostos, objeções e família. Elas aparecem em três lugares, sempre as mesmas:
- na **ficha do contato** (Contatos);
- na **faixa da conversa**, botão **notas**;
- na **janela do cartão do funil**, no lado direito.

Como usar:
- **Nova nota:** escolha o tipo (Geral, Perfil, Preferência, Objeção ou Família), dê um título se quiser e escreva. Dá para **fixar** (vai para o topo), **editar** e **apagar**.
- Notas escritas por você valem em todos os planos (módulo Conversas).
- Se a conversa ainda não é um contato da base, ele é criado com o nome e o número dela ao salvar a primeira nota.
- Não anote **grau de óculos nem outros dados sensíveis** (saúde, religião, política, sindicato). Se você escrever algo assim, o app **avisa** ("evite anotar dado de saúde; ele pode ir para a IA na nuvem") mas salva a nota. Para proteger o cliente, a nota que parecer ter dado sensível **nunca entra** no que é enviado à IA.
- As notas entram, **anonimizadas**, no contexto da **sugestão de resposta** da IA (nome e telefone viram marcadores). As escritas pela IA vão marcadas como "não confirmadas" e só entram com o módulo Perfil do cliente pela IA ligado.
- **Excluir o contato apaga também as notas dele.**

**Mapear perfil com IA** (módulo "Perfil do cliente pela IA", plano Completo, com o Assistente de IA ligado):
- O botão **Mapear perfil** manda a conversa para a IA, **anonimizada**, e ela anota o que o cliente disse, por exemplo "prefere armação leve", "comprou para a filha", "achou caro". Essas notas ficam marcadas **IA** e você pode editar ou apagar.
- A IA recebe as notas que já existem e **só propõe o que é novo**. Se não achar nada, o app avisa.
- A IA **nunca anota saúde** (grau ou receita de óculos, doenças, remédios), religião, política nem telefone ou endereço. O app confere o texto de novo antes de salvar e descarta o que parecer sensível.
- **Sozinho:** quando uma conversa fica **2 horas parada** depois de pelo menos **10 mensagens novas**, o app mapeia o perfil sem você pedir. Isso vale só para contatos que já estão na base e para conversas dos últimos 3 dias, e no máximo 3 por vez. Se a IA falhar com um contato, o app espera 1 hora antes de tentar de novo (mesmo se você fechar o app). Esses usos aparecem no registro da IA como "perfil_cliente_auto". Para **desligar**, tire o módulo em Configurações → Módulos.
- Precisa de um provedor de IA configurado (seção 12).


---

## 6. Campanhas

1. **Campanhas → Nova campanha.**
2. Dê um nome e escolha o **público**:
   - **Por etiqueta:** com 2 ou mais etiquetas, escolha se a pessoa precisa ter **qualquer uma** ou **todas**.
   - **Colunas do funil:** marque uma ou várias colunas, de qualquer funil. Dá para filtrar também por etiqueta.
   - **Todos os contatos** ou **Grupos**.
   - Em todos os casos dá para excluir uma etiqueta (ex.: não enviar para "Inativo"). O app mostra quantos vão receber.
3. Escreva a **mensagem**.
   - Escreva **2 ou mais versões** com palavras diferentes. O app sorteia uma para cada pessoa, e isso reduz bastante o risco de bloqueio.
   - Use `{primeiro_nome}`, `{nome}`, `{loja}` e os campos dos contatos.
   - Use `{Oi|Olá|E aí}` para o app escolher uma das palavras.
   - Com a IA ligada, **Gerar versões com IA** escreve variações para você.
4. Deixe ligado o rodapé **"responda SAIR para não receber"**.
5. Se quiser, anexe imagem, vídeo, áudio ou PDF. A mensagem vira a legenda.
6. Confira a **prévia** e use **Enviar teste para mim** para ver no seu celular.
7. **Iniciar campanha** começa agora. Se você preencher uma data em "Agendar para", ela começa sozinha nesse horário.

### Acompanhar
Clique na campanha para ver:
- **progresso:** enviadas, entregues, lidas, quem respondeu, falhas, sem WhatsApp e quem pediu para não receber;
- **situação agora:** "aguardando o intervalo de segurança", "pausa longa", "fora do horário", "limite diário atingido";
- **ações:** **Pausar**, **Retomar**, **Cancelar**, **Reenviar falhas** e **Relatório** (planilha CSV);
- **Duplicar** (na lista): reaproveita uma campanha.

Campanhas continuam de onde pararam mesmo se o app fechar ou a internet cair.

---

## 7. Proteção anti-bloqueio

Em **Configurações → Proteção anti-bloqueio** (vale para campanhas e lembretes de cada conta):

| Ajuste | Padrão | Para que serve |
|---|---|---|
| Intervalo entre mensagens | 60 a 180 s (sorteado) | Ritmo humano |
| Pausa longa | a cada 18 envios, de 10 a 20 min | Evita sequência longa de disparos |
| Limite por dia | 200 | Teto diário por número |
| Horário e dias | 9h–19h, segunda a sábado | Só envia em horário comercial |
| Simular "digitando…" | ligado | Mostra digitando antes de enviar |
| Aquecimento de número novo | desligado | 20 mensagens no 1º dia, +15 por dia |
| Pausar se poucos responderem | desligado (0%) | Depois de 30 envios, pausa se a taxa de resposta cair abaixo do mínimo |
| Pausar após falhas seguidas | 5 | Para de insistir quando algo está errado |

Os botões **Mais seguro / Equilibrado / Mais rápido** preenchem os números. **O que mais protege o número:** mandar só para quem já é cliente, sem link na primeira mensagem, e com mensagens que convidam a responder.

---

## 8. Respostas automáticas

Respondem sozinhas em conversas individuais (nunca em grupos):
- **Palavra-chave:** ex.: "horário, que horas, aberto" → "Funcionamos de seg a sáb, das 9h às 19h". Não precisa acertar acento nem maiúscula.
- **Fora do horário:** responde quem escreve fora do expediente que você definir.
- **Primeira mensagem:** boas-vindas para quem fala com a loja pela primeira vez.

O app não repete a mesma resposta para a mesma pessoa dentro do intervalo escolhido e responde no máximo 30 vezes por hora. Isso evita conversa em círculo com outros robôs.

---

## Robô de atendimento com IA

A IA responde os clientes pelo WhatsApp, em conversas individuais, usando o que você contou em **Assistente de IA → Meu negócio**, o playbook, as notas do cliente e as últimas mensagens da conversa. É um módulo do plano **Completo** e só liga com o **Assistente de IA** ligado (**Configurações → Módulos**). Os ajustes ficam em **Configurações → Robô de atendimento**.

### Ligar
1. Ligue o módulo **Robô de atendimento com IA** e confira se o Assistente de IA tem um provedor cadastrado e o contexto do negócio preenchido.
2. Em **Configurações → Robô de atendimento**, ligue o robô e escolha **quando a IA atende**:
   - **Só conversas novas** (padrão): quem fala com a loja pela primeira vez é atendido pela IA. Conversas antigas, ou que a loja começou, continuam com você: a IA nunca entra nelas nem as retoma sozinha, mesmo que você escreva um contexto extra ou devolva o atendimento pelo botão (só o botão **Devolver para a IA** liga a IA numa conversa antiga, e por escolha sua).
   - **Só fora do horário de atendimento**: usa o horário da resposta automática "fora do horário" (ou segunda a sábado, das 8h às 18h, se não houver). O horário é conferido a cada mensagem e de novo na hora de enviar: se a conversa começou à noite e a loja abriu antes de a IA responder, quem atende é a equipe. Conversas que você devolveu para a IA continuam com ela. A mensagem de boas-vindas e a de fora do horário não calam a IA: ela ainda responde à pergunta do cliente, mesmo que a mensagem automática já tenha saído na conversa.
   - **Sempre**: inclui conversas antigas.

Mensagens com mais de 15 minutos (por exemplo, as que chegam quando o app volta a conectar) não recebem resposta tardia da IA.
3. Ajuste os limites: **respostas por hora** (somando todas as conversas do número) e **respostas por conversa** (em 24 horas).

### Quem está atendendo
No topo de cada conversa individual há uma etiqueta: **IA atendendo**, **Atendimento humano** ou **Esperando atendente**.
- **Assumir atendimento**: a IA para na hora. Se você escrever na conversa (texto, arquivo, localização, contato ou enquete, pelo app ou pelo celular), ela também para sozinha. No app, ela para assim que você aperta enviar, antes de o envio terminar (um arquivo grande não é mais respondido por cima pela IA). Se o WhatsApp trocar o identificador da conversa pelo número e as duas já tinham um registro, vale o de quem atende: atendimento humano vence espera, que vence IA, e o contexto extra é mantido. Mensagens que o próprio WhatsApp envia pela sua conta (como a saudação ou a mensagem de ausência do WhatsApp Business) também fazem a IA parar: é o lado seguro, e o botão **Devolver para a IA** fica sempre à mão no topo da conversa.
- **Devolver para a IA**: a IA volta a atender e, se o cliente ficou sem resposta, já responde.
- **Retomada automática** (só em conversas que a IA já atendeu): se você assumiu e o cliente ficou esperando por 30 minutos (dá para mudar em **Minutos até a IA retomar**), a IA retoma e a conversa mostra **IA retomou o atendimento**.
- **Contexto extra**: escreva uma instrução só para aquela conversa (por exemplo, "ofereça a armação X"). Ela vai junto de cada resposta da IA.

### Passar para um atendente
A IA para e avisa o cliente ("Vou chamar a Ana para continuar o seu atendimento") quando:
- o cliente pede uma pessoa;
- aparece reclamação ou palavra de risco (como Procon, golpe, advogado);
- o cliente manda foto, arquivo ou áudio sem texto;
- a IA não sabe responder pelas informações da loja;
- o cliente está pronto para fechar a compra, se você ligar **Passar para um atendente na hora de fechar a venda**.

Em **Atendentes e assuntos** escreva uma pessoa por linha, com os assuntos dela (exemplo: `Ana: lentes de contato, financeiro`). A IA escolhe o atendente pelo assunto. Sem lista, a conversa vai para "qualquer atendente".
O app avisa com uma notificação e a conversa entra no filtro **Esperando atendente**. O app não tem login por atendente: é um aviso e um filtro, não uma permissão. Quando alguém responde, a conversa passa a ser atendimento humano.

### Segurança
- Respostas por **palavra-chave** (seção 8) e o pedido de **SAIR** vêm antes da IA. O SAIR é gravado mesmo que Campanhas e Lembretes estejam desligados. Quem pediu para não receber mensagens não recebe resposta da IA.
- Só conversas individuais: nada de grupos, listas de transmissão, canais ou status.
- Se o cliente repetir a mesma mensagem várias vezes ou devolver o seu próprio texto (sinal de outro robô), a IA não responde e avisa uma pessoa.
- A IA **nunca responde em grupos**.
- Antes de enviar, o app confere a resposta: preço (em R$, reais ou por extenso), percentual, parcelas, prazo, desconto, brinde, oferta, telefone, Pix, e-mail e links que **não estejam no contexto da loja** (Assistente de IA → Meu negócio) ou na sua instrução da conversa bloqueiam o envio, e a conversa passa para uma pessoa. O playbook e o campo "O que a IA não pode falar" não servem de fonte para liberar nada. Resposta que cite regras internas, o playbook ou deixe escapar marcas de anonimização como [cliente] também é bloqueada, sem aviso ao cliente.
- O que o cliente escreve é tratado como texto, nunca como ordem: pedidos como "ignore as regras" não mudam o comportamento da IA.
- Campanhas e o robô dividem o mesmo **limite diário** (a vaga é reservada na hora de enviar, então os dois juntos nunca passam do limite) e nunca enviam para a mesma pessoa ao mesmo tempo: se a campanha está falando com ela, a resposta da IA espera uns segundos e tenta de novo.
- Toda resposta sai pela mesma fila das respostas automáticas (intervalo de segundos entre envios), mostra **digitando…** com um atraso parecido com o de uma pessoa e conta no **limite diário** de envios do número. Os limites por hora (até 60) e por conversa (até 30) são reservados ao enfileirar, e um último conferido vale na hora de enviar: se você assumir, desligar o robô, o cliente pedir SAIR ou chegar uma mensagem nova, a resposta que estava na fila é descartada.
- Áudio do cliente: com a transcrição automática ligada (Configurações → Transcrição de áudio), a IA espera até 1 minuto pela transcrição; sem ela, passa para uma pessoa.
- Se o provedor de IA ficar fora do ar, a IA **para**, a conversa vai para **Esperando atendente** e você recebe uma notificação. Nenhum texto genérico é enviado ao cliente.
- A cada resposta, trechos **anonimizados** da conversa (sem telefone, CPF, e-mail nem endereço) vão para o provedor de IA que você configurou. Notas com dado de saúde nunca vão, e, quando o pedido vai para um provedor na nuvem (inclusive como reserva da IA no computador), as linhas da conversa, das notas e da instrução que falam de saúde, religião, política etc. são trocadas por um aviso de trecho omitido. O playbook também sai anonimizado.

---

## Recuperar vendas com desconto

A IA escreve, para o cliente que pediu orçamento e sumiu, até 3 mensagens para retomar a conversa. É um módulo do plano **Completo** e só liga com o **Assistente de IA** ligado (**Configurações → Módulos**). Fica em **Automações → Recuperar vendas**, uma regra por número de WhatsApp. Vem desligado.

### Quem entra
A loja respondeu (uma pessoa ou o robô de atendimento) e o cliente ficou **24 horas** sem escrever (você muda isso). Respostas automáticas de boas-vindas, de fora do horário, campanhas e lembretes **não contam** como resposta da loja. E o cliente precisa estar em algo que **você escolheu** na aba **Regra**, em **Quem entra na recuperação**:
- **colunas de funil** (você marca as colunas, de qualquer funil);
- **etiquetas** (você marca as etiquetas);
- ou, se você ligar, **interesse de compra** visto pela IA (ela lê trechos anonimizados de conversas paradas).

O app **não adivinha pelo nome**: uma coluna ou etiqueta chamada "Orçamento" só conta se você marcou. Sem nenhuma coluna nem etiqueta marcada, ninguém entra por funil ou etiqueta (só por interesse, se ligado). Colunas **de ganho ou perdido** nunca entram, e isso vem do tipo da coluna, não do nome. Cliente cujos cartões estão só em colunas de ganho ou perdido também não entra pela etiqueta.

Para não acordar conversas antigas, só entra quem ficou em silêncio de 24 horas até mais 3 dias, e que escreveu nos últimos 30 dias. Quem pediu para não receber nunca entra, e quem disse **SAIR** nunca mais é chamado por esta função. Grupos não entram. Cada cliente tem **no máximo um ciclo a cada 30 dias**; passado esse prazo, só volta se a última mensagem dele foi de verdade (não "ok", "hm" ou um emoji). Se o computador ficou desligado e um acompanhamento venceu há mais de 48 horas, ele **expira** em vez de mandar mensagem velha.

### As tentativas
Até **3 tentativas**. O padrão é no dia 1, no dia 3 e no dia 7 (24 horas de silêncio, depois 2 dias e mais 4 dias). A IA escreve cada uma com o contexto do negócio, as notas do cliente e a conversa **anonimizada** (sem telefone, CPF, e-mail, endereço nem nome). A 1ª é um lembrete leve, a 2ª traz um motivo útil e a 3ª é uma despedida gentil. Se a conversa mostra que o cliente recusou, a IA desiste.

### O desconto
Você define: o percentual (até 50%), a partir de qual tentativa ele entra (padrão: só na última), a validade em dias, um teto em reais (opcional) e a condição, como "na compra à vista". **O número do desconto vem só da regra**: a IA nem chega a ver o percentual. Ela escreve uma marca e o app troca pelo texto oficial, por exemplo "um desconto de 10% na compra à vista, válido por 7 dias". Antes de enviar, o app confere o texto: qualquer outro percentual, valor, brinde, "sem juros" ou promoção que não seja a sua regra (e preço ou prazo que não esteja no contexto da loja) **bloqueia a mensagem**. Se você mudar o desconto, as mensagens que já estavam escritas com o número antigo são descartadas e a IA escreve de novo.

### Aprovar antes (padrão) ou automático
- **Aprovar antes:** a mensagem fica na aba **Para aprovar**, com o texto, a tentativa e o desconto. Você aprova com um clique, **edita** antes (o texto editado passa pelo mesmo conferidor) ou escolhe **Não enviar esta** (o acompanhamento segue para a próxima tentativa). Você recebe uma notificação quando chega uma nova.
- **Automático:** em **Regra**, mude "Como as mensagens saem". A IA envia sozinha, com o mesmo conferidor, só dentro do horário e dos limites.

### Quando para sozinha
- O cliente **responde** (qualquer mensagem). Se o robô de atendimento estiver ligado, ele atende a resposta como de costume.
- A venda é marcada (**Virou venda** ou **Perdida**).
- O cliente pede **SAIR** (por texto ou por áudio já transcrito): o pedido é gravado mesmo que Campanhas, Lembretes e o robô estejam desligados, e vale para sempre.
- Um **atendente escreve** na conversa, pelo app ou pelo celular.
- Você clica em **Parar de acompanhar** na aba Acompanhamentos.
- Você **desliga a regra ou o módulo**: os acompanhamentos em andamento param (religar não os reanima).
Nesses casos, a mensagem que estava na fila é descartada. A conferência é refeita na hora de enviar, então nada sai depois de uma dessas mudanças.

### Junto com o robô de atendimento
O **robô vence**. Ele responde quando o cliente escreve e a recuperação só age com o cliente em silêncio, então elas não se cruzam. A recuperação espera enquanto o robô tem uma resposta a caminho na conversa e não entra em conversa que o robô passou para um atendente (**Esperando atendente**).

### Limites anti-bloqueio
O horário de envio e a validade do desconto seguem o relógio e o fuso do computador onde o app está. Tudo sai pela mesma fila das respostas automáticas (intervalo de segundos, "digitando…"), conta no **limite diário** de envios do número, respeita o **horário de envio** da Proteção anti-bloqueio (fora dele, a mensagem aprovada espera) e tem um limite próprio de mensagens por dia (padrão 20). Mensagem aprovada que não conseguiu sair em 36 horas é descartada; mensagem que ninguém aprovou em 3 dias também.

### Quanto voltou e quanto custou
Uma venda **ganha** marcada até 14 dias depois de uma mensagem de recuperação (ou até o fim da validade do desconto, se for maior) entra em **Vendas** e no **Painel** com a origem **Recuperação**, desde que o cliente tenha respondido depois da mensagem. Venda perdida nunca vira recuperação, e valor acima de R$ 100.000 é tratado como erro de digitação e não entra. A recuperação tem precedência sobre campanha e anúncio. A aba mostra, nos últimos 30 dias, as mensagens enviadas, quem respondeu, **quanto voltou** e **quanto custou em desconto**. O custo é uma **estimativa** (aparece como "estimado"): o valor da venda é tratado como o que o cliente pagou, já com o desconto, e só conta se a última mensagem trazia desconto ainda dentro da validade. Nunca passa do percentual da regra sobre o valor e respeita o teto em reais. Apagar a venda tira a recuperação e o custo, e o cliente só pode entrar de novo depois dos 30 dias. Apagar a venda tira a recuperação e o custo.

### Privacidade
A cada mensagem, trechos **anonimizados** da conversa vão para o provedor de IA que você configurou. Notas com dado de saúde nunca vão.

---

## 9. Grupos

Clique em **Atualizar** para ler os grupos do número. Cada função liga separada em Módulos:
- **Envio para grupos:** em Campanhas, escolha o público **Grupos**.
- **Extrair membros:** selecione grupos e clique em **Copiar membros para Contatos**. Eles ganham a etiqueta "Grupo: nome". Quem esconde o número no WhatsApp não é copiado.
- **Criar grupo:** a partir de uma etiqueta ou de uma lista de números.
  - Para proteger o número, o app adiciona 5 pessoas de cada vez, a cada 30 a 60 s.
  - Quem não puder ser adicionado (privacidade) recebe o **link de convite**.
- **Moderação** (o número precisa ser administrador):
  - boas-vindas com `{nome}` marcando a pessoa;
  - apagar links de quem não é admin;
  - palavras proibidas;
  - remoção automática depois de N avisos.
- O ícone de corrente copia o **link de convite**.

---

## 10. Lembretes

Mensagens automáticas em datas de cada cliente, enviadas **uma vez por pessoa** por período:
- **Aniversário:** usa a data de nascimento do contato.
- **Dias depois de uma data:** ex.: 7 dias depois da `data_compra` (pós-venda).
- **Todo ano na data:** ex.: revisão anual de grau um ano depois da compra.

Ao ligar o módulo Lembretes pela primeira vez, o app já cria o lembrete **Aniversário** (ligado, às 10h, mensagem simples sem oferta). Você pode editar ou apagar. Use os modelos prontos. Cada envio fica registrado na ficha do contato, em **Lembretes enviados** (seção 5). A lista mostra quantos contatos recebem **hoje**. Os envios saem no horário escolhido, respeitando a Proteção anti-bloqueio, e aparecem em Campanhas como "Lembrete: …".

---

## Status

Poste no **status do WhatsApp** da loja pelo computador. Ligue o módulo **Status do WhatsApp** em Configurações → Módulos; a página **Status** aparece no menu, em Marketing.

**Criar um status:** clique em **Novo status** e escolha:
- **Texto:** até 700 letras, com cor de fundo e tipo de letra.
- **Foto:** JPG, PNG ou WEBP, até 16 MB, com legenda opcional.
- **Vídeo:** MP4 de até 90 segundos e 16 MB, com legenda opcional. Vídeo maior ou mais longo é recusado (o app confere o tamanho e a duração do arquivo; se não conseguir ler a duração, também recusa): corte antes de postar.

A prévia ao lado mostra como fica.

**Quem vê:**
- **Todos os contatos com WhatsApp;**
- **Só quem tem uma etiqueta;** ou
- **Todos menos quem tem uma etiqueta** (ex.: todos menos "Fornecedor").

Ficam sempre de fora quem pediu para não receber mensagens e quem ainda não tem WhatsApp confirmado. O app confirma o WhatsApp de um contato quando envia uma campanha para ele ou quando o contato é criado a partir de uma conversa ou de um grupo. Contatos só importados da planilha entram depois da primeira campanha. A tela mostra quantas pessoas vão poder ver.

**Lista grande:** acima de 1.000 pessoas, a tela avisa. O WhatsApp envia a postagem para cada aparelho de cada pessoa da lista, então ela demora mais e pesa no celular. Dá para postar mesmo assim; se puder, use uma etiqueta para um público menor.

**Quando:** **Agora** (precisa estar conectado) ou **Agendar** para uma data e hora. O app precisa estar aberto na hora marcada. Se o WhatsApp estiver desconectado, o status sai assim que conectar. Se passar mais de 24 horas da hora marcada sem conexão, a postagem não sai e aparece como **Falhou**.

**Limite por dia:** por padrão, até **10 postagens por dia** por conta (contando as já postadas e as agendadas para o mesmo dia). Mude o número no topo da página (de 1 a 50). Postar demais seguido pode fazer o WhatsApp tratar o número como robô.

**Histórico:** a lista mostra cada postagem com a situação (**Agendado**, **Postando**, **Postado**, **Falhou** ou **Cancelado**), o público, quantas pessoas e a data. Postagens agendadas podem ser **canceladas** antes da hora. Se o WhatsApp não responder em 1 minuto, a postagem aparece como **Falhou** (confira no celular se o status saiu): como o resultado é incerto, ela continua contando no limite do dia e as próximas postagens esperam até 10 minutos (ou até o envio antigo terminar; se terminar, a postagem passa para **Postado**). Quem pediu para sair (SAIR) fica de fora do público mesmo que o pedido tenha chegado pelo identificador interno do WhatsApp. Os arquivos antigos são apagados de hora em hora. O status some do WhatsApp em 24 horas, como qualquer status. Os arquivos de foto e vídeo ficam guardados no computador por 7 dias e depois são apagados (a limpeza roda de hora em hora enquanto o app está aberto).

**Quem viu:** por enquanto o app não mostra quem viu. Confira no celular.

---

## 11. Vendas

No topo de cada conversa:
- **Virou venda:** valor, produto e forma de pagamento;
- **Perdida:** motivo (preço, sem estoque, só pesquisando…).

A página **Painel** (antes chamada Vendas) mostra, com filtro de **período** e de **número** (um número, ou todos juntos):
- **Números do topo:** faturado, vendas, ticket médio, conversas novas, quantas dessas conversas viraram venda e vendas recuperadas;
- **Faturamento:** gráfico por dia, semana ou mês, com botão "Ver em tabela";
- **Funil:** escolha um funil e veja, por coluna, quantos cartões estão ali e a soma dos valores, mais o total do funil. As colunas aparecem na ordem que você definiu e o painel não interpreta o que cada uma significa;
- **De onde vieram as vendas:** campanha, lembrete, recuperação, anúncio, site (UTM) e espontâneo, com vendas, faturado, ticket e **fechamento** (das vendas e perdas que você marcou naquela origem, quantas foram vendas; não é a conversão das conversas novas). "Site (UTM)" e "Anúncio" só aparecem com o módulo ligado;
- os motivos de perda mais comuns;
- a lista de registros (quando um só número está escolhido).

**O que o Painel mede e o que não mede**
- Só entra o que você marcou na conversa ("Virou venda" ou "Perdida"). Venda não marcada não aparece.
- **Conversas novas** são pessoas cuja primeira mensagem recebida caiu no período (grupos não contam). O mesmo cliente com o número e com o identificador novo do WhatsApp conta uma vez só. **Viraram venda** conta, entre essas pessoas, quem tem venda ganha marcada **até hoje**, mesmo que tenha fechado depois do período.
- O ticket médio não conta venda marcada com valor zero.
- O **funil** é a foto de hoje: só a quantidade de cartões e a soma dos valores em cada coluna. O app não presume o que cada coluna quer dizer, não calcula passagem entre colunas nem tempo parado.
- A venda conta para a campanha ou o lembrete enviado ao cliente nos 7 dias anteriores. Se não houve nenhum, e a conversa veio de anúncio (módulo Anúncios da Meta ligado), aparece como **Anúncio** (até 30 dias depois do primeiro contato). Se o telefone do cliente estava na planilha de leads do site até 30 dias antes da venda, aparece como **Site (UTM)**. Sem nada disso, é **Espontâneo**.
- Sem o aviso do WhatsApp de que veio de anúncio, ou sem a planilha de leads, essas vendas caem em Espontâneo. O Painel avisa quando não há dado de anúncio ou de planilha.
- **Recuperação** conta as vendas marcadas até 14 dias depois de uma mensagem do módulo Recuperação de vendas e mostra, no cartão **Recuperadas**, quanto voltou e quanto custou em desconto (estimativa).

### Funis (kanban)

O menu **Funis** organiza os clientes em etapas, como num quadro de post-its.

- **Novo funil:** comece de um modelo (vendas, pedidos e entregas, pós-venda ou em branco). Cada número de WhatsApp pode ter vários funis.
- **Editar funil:** renomeie, mude cores, reordene com as setas e crie ou apague colunas.
  - Cada coluna tem um tipo: **em andamento**, **ganho** ou **perdido**. Ganho e perdido aparecem nos totais do topo.
  - Em ⚙︎:
    - **Etiqueta automática:** colocada no contato quando o cartão entra na coluna. Se quiser, ela sai quando o cartão sai.
    - **Alerta de cartão parado:** depois de X dias na coluna, o cartão fica amarelo.
  - Apagar uma coluna com cartões leva os cartões para a coluna anterior.
- **Adicionar contatos:** escolha contatos da base ou traga todos que têm uma etiqueta.
  - Pela conversa: na faixa abaixo do nome, clique em **+ funil**. Se a conversa ainda não é contato, ele é criado com o nome e o número dela.
- **Mover:** arraste o cartão para outra coluna ou ordem. Também dá pelo próprio cartão, ou pela faixa da conversa clicando na etapa.
- **Cartão:** clique no cartão para abrir a janela dele no meio da tela.
  - **À esquerda**, a conversa completa: histórico (role para cima para ver as mais antigas), caixa de mensagem, anexos e áudio. Dá para responder dali mesmo.
  - **À direita**, os dados do cartão: coluna, etiquetas, valor do negócio, nota, tempo na coluna e em que outros funis o contato está.
  - Contato que ainda não conversou: a conversa aparece vazia e você pode mandar a primeira mensagem.
  - A conversa aberta na tela **Conversas** não muda.
  - **Esc**, o **X** ou um clique fora fecham a janela. O quadro continua onde estava, com a mesma rolagem e os mesmos filtros. Se houver **valor ou nota sem salvar**, o app pergunta antes de fechar. Dentro da janela, o **Esc** fecha primeiro o que estiver aberto por cima (seletor de reação, menu de anexo, formulário de localização, contato ou enquete) e só depois a janela.
  - **Abrir na tela Conversas** leva para a conversa na tela inteira.
- **Disparar para uma coluna:** no menu **⋯** da coluna, **Disparar campanha para a coluna** abre uma campanha nova com a coluna já escolhida. Ela segue todas as regras anti-bloqueio. Se houver filtro de etiquetas no quadro, ele vai junto.
- Excluir um contato (LGPD) tira os cartões dele de todos os funis.

### Leads do site (planilha e relatório por origem do anúncio)

Para lojas que têm o site da agência com formulário gravando numa Google Planilha. Módulo **Planilha de leads** (plano Marketing). Ligue em **Configurações → Módulos**.

**Configurar** (uma vez, em **Configurações → Integrações**):
1. Cole o **link do Apps Script** (o que termina em `/exec`) e a **senha da integração**. A senha fica guardada de forma protegida neste computador e nunca é mostrada de volta. Para trocar, digite a nova; em branco mantém a atual.
2. A planilha precisa do **doPost novo** no Apps Script. Ele exige a senha e entrega só as linhas novas. A agência faz essa atualização (trecho de referência em `docs/apps-script-leads-doget.gs`). A planilha nunca é publicada na internet.
3. Opcional: **Criar contato para cada lead novo**. O contato ganha a etiqueta “Lead site” e, se você escolher um funil, um cartão na primeira coluna dele. Contatos existentes também recebem a etiqueta e o cartão, preservando seus dados. Falhas nessa criação ficam pendentes para nova tentativa.

Use uma senha própria da integração, longa e aleatória, diferente da senha do formulário do site, na propriedade `SEGREDO_INTEGRACAO_LEADS`. O app envia a senha no corpo JSON de um POST. O `doGet` é mantido apenas por compatibilidade: a senha na URL pode aparecer em históricos e registros; prefira POST. Confira que o formulário do site tem o aviso de consentimento. Ainda não há rotina de retenção dos leads; defina e execute a exclusão conforme a política da loja.

**Atualização:** o app busca leads novos a cada 30 minutos e também no botão **Atualizar agora**. Se a internet cair ou o Google demorar, o app avisa e tenta de novo depois, sem travar. A mesma linha da planilha nunca entra duas vezes. Se você trocar o link da planilha, o app recomeça do zero (a data de corte e as páginas pendentes são limpas) e ignora qualquer atualização que ainda estivesse em andamento com o link antigo. Os contatos dos leads novos são criados em lotes, sem travar o app.

**Página Leads do site** (menu Marketing):
- Os totais de **leads, conversaram, compraram e faturamento** no período escolhido.
- Tabela **por origem (utm_source), por campanha (utm_campaign) e por anúncio (utm_content)**, com a **taxa de compra** (quem comprou dividido pelos leads). Leads sem origem aparecem em “(sem origem)”. **Exportar CSV** abre no Excel.
- A lista dos leads recentes mostra, para cada um, se **virou conversa**, se **é contato**, em que **etapa do funil** está e se **virou venda** (com o valor).

**Como o app liga o lead à conversa:** pelo telefone, com a mesma regra de DDD e código do país dos Contatos. Lead sem telefone válido fica na lista, mas não é cruzado. A venda só conta se foi marcada **depois** de o lead chegar. Se a mesma pessoa preencher o formulário duas vezes, a compra conta uma vez só.

---

## Anúncios da Meta

Quando o cliente clica num anúncio de "Enviar mensagem" do Facebook ou do Instagram e chama a loja no WhatsApp, o app percebe e guarda de onde ele veio. Ligue em **Configurações → Módulos → Anúncios da Meta** (plano Marketing).

- A conversa ganha a etiqueta **Veio de anúncio**, na lista e no topo da conversa.
- A venda dessa conversa entra no **Painel** com a origem **Anúncio** se fechar em até **30 dias** depois do primeiro contato vindo do anúncio (e sem campanha ou lembrete enviado nos 7 dias anteriores). Passado esse prazo, a venda conta como espontânea.
- Se o WhatsApp trocar o identificador da conversa pelo número do cliente, a etiqueta e a origem acompanham. Vale sempre a **primeira** origem da conversa: link, código e data do anúncio andam juntos (uma mensagem mais antiga de outro anúncio troca a origem inteira; uma mais nova só completa o que faltava se for o mesmo anúncio). Ao excluir a conversa ou apagar os dados da conta, a origem some junto.
- O app olha também as conversas antigas, aos poucos e sem travar, logo depois de abrir.
- Fica guardado só neste computador: a origem (Facebook ou Instagram), o número do anúncio, o endereço dele e, quando o WhatsApp entrega, o código de clique (`ctwa_clid`). Nada é enviado para a Meta nesta etapa.

**Aviso honesto:** o WhatsApp Web nem sempre entrega o código de clique. Sem ele, o app ainda mostra a etiqueta e a origem da venda; só o envio automático para a Meta depende de outro caminho (telefone em hash), que vem numa próxima versão.

### Conferir se o código de clique chegou (teste com anúncio real)

1. Clique num anúncio de clique para o WhatsApp de um número de teste e envie a mensagem.
2. Abra **Configurações → Sistema → Abrir pasta** e a pasta `logs`.
3. Procure a linha "Anúncio: conversa que veio de anúncio". O campo `ctwaClid` mostra **chegou** ou **não veio**. O registro não tem telefone, nome nem texto do cliente.

---

## 12. Assistente de IA

### Configurar IA em um passo
O botão **Configurar IA**, no alto da página **Assistente de IA**, abre uma tela só:
1. O app olha o computador (memória, processador e espaço livre) e mostra a recomendação.
2. **IA no computador** (privada, grátis, funciona sem internet):
   - clique em **Instalar IA no computador**. O app baixa o motor (llama.cpp) e um modelo leve (Gemma 3 1B, cerca de 800 MB) e confere cada arquivo antes de usar. Não pede senha de administrador;
   - se a internet cair, clique de novo: o download continua de onde parou. **Parar download** guarda o que já baixou;
   - a IA no computador só liga quando alguma tarefa precisa dela e desliga sozinha depois de 5 minutos parada. Desligada, não gasta memória. Ela faz uma tarefa por vez e usa no máximo metade do processador;
   - fica com as tarefas rápidas (entender o que o cliente quer, etiquetar, tirar datas). As que pedem texto bom (sugestões de resposta, versões de campanha, playbook, preencher o contexto) vão primeiro para a nuvem, e a IA no computador fica de reserva;
   - pedido grande demais para a IA no computador vai direto para a nuvem;
   - computadores com 16 GB de memória ou mais podem ligar também o **modelo médio** (Qwen3 4B, cerca de 2,4 GB), que escreve melhor. Com ele ligado, as sugestões de resposta e os textos também são feitos no computador, e a nuvem fica de reserva;
   - **Remover IA local** apaga todos os arquivos dela.
3. **IA gratuita na nuvem (Groq):** clique em **abrir o site do Groq**, crie a chave, cole e clique em **Salvar e testar**.

O recomendado é usar as duas: a IA no computador como principal para as tarefas rápidas e a nuvem como reserva. Em computador mais fraco, a IA no computador responde devagar.

### Meu negócio
Na aba **Meu negócio** você conta para a IA como é a loja. Vale para o número de WhatsApp escolhido. Os campos:
- o que a loja vende e para quem;
- produtos e serviços, com preço e prazo;
- horário de funcionamento e endereço;
- formas de pagamento;
- troca, garantia e entrega;
- perguntas frequentes;
- tom de voz;
- o que a IA **não** pode falar.

**Preencher com a IA:** cole o texto do site ou do Instagram da loja e a IA separa nos campos. Revise e clique em **Salvar**.

A IA usa esse contexto nas sugestões de resposta, nas versões de campanha e no playbook, e é orientada a não inventar preço, prazo ou desconto que não esteja escrito ali. Se o texto ficar muito grande, a IA recebe só uma parte: corta primeiro as perguntas frequentes e o tom de voz. O que ela não pode falar nunca é cortado.

### Provedores (manual)
Em **Assistente de IA → Provedores**, dá para adicionar outros provedores. Cada um tem o link para criar a chave:
- **Groq:** rápido, cerca de 1.000 pedidos por dia, não treina com seus dados;
- **Google Gemini:** no plano grátis pode usar os textos para melhorar produtos;
- **OpenRouter**, **Mistral**, ou **Ollama** (roda no próprio computador);
- **Claude (pago, opcional):** usado só quando todos os gratuitos falham, com limite de chamadas por mês.

O app usa primeiro os gratuitos e **troca sozinho de provedor** quando um atinge o limite do dia ou do minuto.

### Privacidade
- **Anonimizar** (recomendado): nomes, telefones, e-mails, CPF e endereços viram marcadores antes de sair do computador.
- **Estrita:** conversas só vão para provedores que não treinam com os dados.
- A aba **Uso** registra cada chamada, sem o conteúdo.

### Usar
- **Sugerir resposta:** botão ✨ ao lado da caixa de texto da conversa. A sugestão aparece na caixa para **você revisar** antes de enviar. A IA nunca envia nada sozinha.
- **Versões de campanha:** no editor de campanha, **Gerar versões com IA**.
- **Playbook de vendas:** depois de marcar algumas vendas e perdas, clique em **Montar playbook**. A IA analisa as conversas e escreve:
  - as abordagens que funcionam;
  - as respostas para objeções;
  - frases prontas;
  - o que evitar.

  Você pode editar o playbook, e as sugestões de resposta passam a segui-lo.

---

## 13. Backup

Seus dados ficam **só neste computador**. Configure o backup para não perder nada se o computador der problema.

1. **Configurações → Backup → Escolher pasta.** O ideal é uma pasta do Google Drive, OneDrive ou um HD externo, ou seja, fora do computador.
2. **Defina uma senha** (mínimo de 8 caracteres). Os backups são criptografados.
   **Anote a senha em lugar seguro: sem ela não é possível restaurar.**
3. Escolha a **frequência**: todo dia, toda semana, ao fechar o app ou só manual.
4. Escolha quantos backups manter. Os mais antigos são apagados sozinhos.

Use **Fazer backup agora** para garantir uma cópia antes de mudanças grandes.

### Restaurar ou trocar de computador
1. Instale o app no computador novo.
2. **Configurações → Backup**: escolha a mesma pasta e clique em **Restaurar** ao lado do backup desejado (ou em **Restaurar de um arquivo…**).
3. Digite a senha do backup. O app reinicia com os dados.
4. Leia o QR Code de novo em cada conta. Por segurança, a conexão do WhatsApp não é levada de um computador para outro.

---

## 14. Atualizações

- **Do app:** toda vez que abre, o app verifica se existe uma versão nova. Se existir, aparece uma faixa no alto com o botão **Baixar**.
  - **Windows:** baixa e mostra **Reiniciar e instalar**.
  - **Mac:** abre a página do novo instalador. Instale como na seção 1.
  - Também dá para verificar em **Configurações → Sistema → Verificar agora**.
- **Do WhatsApp:** o app busca sozinho a versão mais recente do WhatsApp Web a cada abertura e a cada 6 horas. Isso evita erros de conexão. A versão em uso aparece no rodapé do menu e em **Configurações → Sistema**.

---

## 15. Tema claro e escuro

No rodapé do menu: ☀ claro, ☾ escuro ou **automático** (segue o computador).

---

## 16. Privacidade e LGPD

- Conversas, contatos e mídias ficam no computador da loja. Nada é enviado para servidores da agência.
- A conexão do WhatsApp fica guardada **criptografada** com a proteção do sistema (Keychain no Mac, DPAPI no Windows).
- Os registros técnicos do app escondem números de telefone, nomes e textos de mensagens.
- Mensagens apagadas para todos são removidas também do computador e dos backups seguintes.
- Documentos salvos a partir das conversas recebem a marca de "baixado da internet": o Windows/Office e o Mac continuam avisando antes de abrir arquivos perigosos.
- Envie mensagens de marketing só para clientes que já compraram. Quem responde SAIR vai automaticamente para a lista de não receber.
- A IA recebe as conversas anonimizadas por padrão (seção 12). O robô de atendimento sempre anonimiza, mesmo que o modo da IA seja outro.
- As notas do cliente ficam só no computador da loja, são apagadas junto com o contato e não guardam dado de saúde (seção 5). O mapeamento de perfil pela IA pode ser desligado em Configurações → Módulos.

---

## 17. Problemas comuns

| Problema | O que fazer |
|---|---|
| **Mac:** ao abrir uma versão nova aparece "Nexu Chat quer usar informações confidenciais armazenadas em 'Disparador Safe Storage'" (o nome interno continua Nexu Chat, para não perder a conexão) | Digite a senha do Mac e clique em **Sempre Permitir**. É o Mac liberando a chave que protege a conexão do WhatsApp. Enquanto a janela não for respondida, o app não conecta. Se ela sumiu atrás de outras janelas, procure no Dock. |
| QR Code expirou | Clique em **Conectar** para gerar outro. |
| "Esta conta foi aberta em outro lugar" | Outro computador usou a mesma conexão. Clique em **Conectar** para voltar a usar aqui. |
| "O WhatsApp recusou a conexão (conta restrita ou banida)" | Verifique o WhatsApp no celular. Se o número foi restrito, aguarde o prazo informado pelo WhatsApp. |
| Conversas antigas não aparecem | Use **Contas → Reimportar histórico**. |
| Mídia não baixa ("Conecte o WhatsApp…") | A conta precisa estar **Conectada** para baixar mídias que ainda não estão no computador. |
| Microfone não funciona | Mac: Ajustes do Sistema → Privacidade e Segurança → Microfone → ative o Nexu Chat. Windows: Configurações → Privacidade → Microfone. |
| Campanha pausada sozinha | Veja o motivo no topo da campanha (falhas seguidas, taxa de resposta baixa). Corrija e clique em **Retomar**. |
| Campanha parada em "fora do horário" ou "limite diário" | É a proteção funcionando; ela continua sozinha no próximo horário permitido. |
| Robô de atendimento parou e a conversa foi para "Esperando atendente" | Veja o motivo na faixa no topo da conversa (cliente pediu uma pessoa, a IA não soube responder, limite atingido ou provedor de IA fora do ar). Resolva, atenda ou clique em **Devolver para a IA**. |
| Assistente de IA: "Nenhum provedor disponível" | Cadastre uma chave em Assistente de IA → Provedores, ou aguarde a pausa do provedor terminar. |
| Precisa enviar os registros para o suporte | **Configurações → Sistema → Abrir pasta** → pasta `logs`. |

---

## 18. Avisos importantes

- O Nexu Chat usa uma conexão **não oficial** com o WhatsApp, a mesma usada pelo WhatsApp Web. O WhatsApp pode restringir números que enviam muitas mensagens para quem não responde. A Proteção anti-bloqueio reduz esse risco, mas ele nunca é zero.
- Mantenha o celular da loja com internet de vez em quando. Se ficar mais de 14 dias desligado, o WhatsApp desconecta os aparelhos vinculados.
