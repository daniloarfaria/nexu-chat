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
- **Filtros**: Todas, Não lidas, Grupos e Arquivadas.
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
| Vendas | Marcar o que virou venda e ver o retorno (seção 11) |
| Assistente de IA | Sugestões de resposta, versões de campanha e playbook (seção 12) |

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
- **Excluir** atende pedidos de exclusão de dados (LGPD). Apaga o contato junto com as conversas, mensagens, fotos e arquivos recebidos e as vendas registradas. Se a pessoa tinha pedido para não receber, só o número fica guardado na lista de bloqueio, para ela nunca mais receber, mesmo se voltar numa planilha.
- **Exportar** gera um CSV com todos os contatos.

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

Use os modelos prontos. A lista mostra quantos contatos recebem **hoje**. Os envios saem no horário escolhido, respeitando a Proteção anti-bloqueio, e aparecem em Campanhas como "Lembrete: …".

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

**Histórico:** a lista mostra cada postagem com a situação (**Agendado**, **Postando**, **Postado**, **Falhou** ou **Cancelado**), o público, quantas pessoas e a data. Postagens agendadas podem ser **canceladas** antes da hora. Se o WhatsApp não responder em 1 minuto, a postagem aparece como **Falhou** (confira no celular se o status saiu). O status some do WhatsApp em 24 horas, como qualquer status. Os arquivos de foto e vídeo ficam guardados no computador por 7 dias e depois são apagados.

**Quem viu:** por enquanto o app não mostra quem viu. Confira no celular.

---

## 11. Vendas

No topo de cada conversa:
- **Virou venda:** valor, produto e forma de pagamento;
- **Perdida:** motivo (preço, sem estoque, só pesquisando…).

O painel **Vendas** mostra:
- faturamento pelo WhatsApp, número de vendas, ticket médio e conversão;
- **de onde vieram as vendas:** a venda conta para a campanha ou o lembrete enviado ao cliente nos 7 dias anteriores, com o valor faturado **por mensagem enviada**;
- os motivos de perda mais comuns.

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
  - **Esc**, o **X** ou um clique fora fecham a janela. O quadro continua onde estava, com a mesma rolagem e os mesmos filtros.
  - **Abrir na tela Conversas** leva para a conversa na tela inteira.
- **Disparar para uma coluna:** no menu **⋯** da coluna, **Disparar campanha para a coluna** abre uma campanha nova com a coluna já escolhida. Ela segue todas as regras anti-bloqueio. Se houver filtro de etiquetas no quadro, ele vai junto.
- Excluir um contato (LGPD) tira os cartões dele de todos os funis.

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
- A IA recebe as conversas anonimizadas por padrão (seção 12).

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
| Assistente de IA: "Nenhum provedor disponível" | Cadastre uma chave em Assistente de IA → Provedores, ou aguarde a pausa do provedor terminar. |
| Precisa enviar os registros para o suporte | **Configurações → Sistema → Abrir pasta** → pasta `logs`. |

---

## 18. Avisos importantes

- O Nexu Chat usa uma conexão **não oficial** com o WhatsApp, a mesma usada pelo WhatsApp Web. O WhatsApp pode restringir números que enviam muitas mensagens para quem não responde. A Proteção anti-bloqueio reduz esse risco, mas ele nunca é zero.
- Mantenha o celular da loja com internet de vez em quando. Se ficar mais de 14 dias desligado, o WhatsApp desconecta os aparelhos vinculados.
