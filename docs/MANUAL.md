# Manual do Disparador

> Versão do app: 0.2.0 · Atualizado em 05/11/2026
> O nome "Disparador" é provisório.

O Disparador conecta o WhatsApp da sua loja ao computador. Com ele você atende os clientes, guarda todas as conversas no computador e, nas próximas versões, também envia campanhas, gerencia grupos e acompanha as vendas.

---

## 1. Instalação

### Mac
1. Abra o arquivo `Disparador-…-mac-arm64.dmg` (Macs com chip Apple, M1 ou mais novos) ou `…-mac-x64.dmg` (Macs Intel).
2. Arraste o Disparador para a pasta **Aplicativos**.
3. **Na primeira vez**, clique com o botão direito no Disparador e escolha **Abrir**. Depois confirme em **Abrir**. Isso só é preciso uma vez, porque o app ainda não tem a assinatura paga da Apple.

### Windows
1. Abra o arquivo `Disparador-…-windows-setup.exe`.
2. Se aparecer "O Windows protegeu o computador", clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Siga o instalador. O atalho fica na Área de Trabalho e no Menu Iniciar.

> Desinstalar o app **não apaga** suas conversas nem a conexão do WhatsApp. Para levar tudo para outro computador, use o **backup** (seção 5).

---

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

### Histórico
- O WhatsApp só envia o histórico de conversas antigas **no momento em que o aparelho é vinculado**. Enquanto isso acontece, aparece no alto da lista o aviso "Sincronizando histórico…", com a contagem de mensagens.
- Quanto tempo de histórico vem depende do celular. Normalmente são meses.
- Para trazer o histórico de novo, use **Contas → Reimportar histórico**. Nada do que já está salvo é apagado e nada fica duplicado.
- Com o app fechado, o celular continua recebendo normalmente. Quando você abrir o app, o que chegou nesse meio-tempo é baixado.

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

### Notificações
Quando chega mensagem e você não está olhando aquela conversa, aparece uma notificação. Clique nela para abrir a conversa. Conversas silenciadas ou arquivadas não notificam.

---

## 4. Módulos

Em **Configurações → Módulos** você liga e desliga as funções de cada conta. O menu mostra só o que está ligado, e assim o app fica simples para quem usa pouco.

| Módulo | Situação |
|---|---|
| Conversas | Disponível |
| Campanhas, Proteção anti-bloqueio | Em construção |
| Respostas automáticas | Em construção |
| Grupos (envio, extrair membros, criar, moderação) | Em construção |
| Lembretes recorrentes | Em construção |
| Vendas, Assistente de IA | Em construção |

---

## 5. Backup

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

## 6. Atualizações

- **Do app:** toda vez que abre, o app verifica se existe uma versão nova. Se existir, aparece uma faixa no alto com o botão **Baixar**.
  - **Windows:** baixa e mostra **Reiniciar e instalar**.
  - **Mac:** abre a página do novo instalador. Instale como na seção 1.
  - Também dá para verificar em **Configurações → Sistema → Verificar agora**.
- **Do WhatsApp:** o app busca sozinho a versão mais recente do WhatsApp Web a cada abertura e a cada 6 horas. Isso evita erros de conexão. A versão em uso aparece no rodapé do menu e em **Configurações → Sistema**.

---

## 7. Tema claro e escuro

No rodapé do menu: ☀ claro, ☾ escuro ou **automático** (segue o computador).

---

## 8. Privacidade e LGPD

- Conversas, contatos e mídias ficam no computador da loja. Nada é enviado para servidores da agência.
- A conexão do WhatsApp fica guardada **criptografada** com a proteção do sistema (Keychain no Mac, DPAPI no Windows).
- Os registros técnicos do app escondem os números de telefone.
- Envie mensagens de marketing só para clientes que já compraram e que não pediram para sair. As próximas versões terão a lista de "não quero receber" automática.

---

## 9. Problemas comuns

| Problema | O que fazer |
|---|---|
| QR Code expirou | Clique em **Conectar** para gerar outro. |
| "Esta conta foi aberta em outro lugar" | Outro computador usou a mesma conexão. Clique em **Conectar** para voltar a usar aqui. |
| "O WhatsApp recusou a conexão (conta restrita ou banida)" | Verifique o WhatsApp no celular. Se o número foi restrito, aguarde o prazo informado pelo WhatsApp. |
| Conversas antigas não aparecem | Use **Contas → Reimportar histórico**. |
| Mídia não baixa ("Conecte o WhatsApp…") | A conta precisa estar **Conectada** para baixar mídias que ainda não estão no computador. |
| Microfone não funciona | Mac: Ajustes do Sistema → Privacidade e Segurança → Microfone → ative o Disparador. Windows: Configurações → Privacidade → Microfone. |
| Precisa enviar os registros para o suporte | **Configurações → Sistema → Abrir pasta** → pasta `logs`. |

---

## 10. Avisos importantes

- O Disparador usa uma conexão **não oficial** com o WhatsApp, a mesma usada pelo WhatsApp Web. O WhatsApp pode restringir números que enviam muitas mensagens para quem não responde. As funções de campanha virão com proteção contra bloqueio, mas o risco nunca é zero.
- Mantenha o celular da loja com internet de vez em quando. Se ficar mais de 14 dias desligado, o WhatsApp desconecta os aparelhos vinculados.
