# Licenciamento: guia interno da agência

> Uso interno. Não enviar ao cliente.

## Como funciona
- Cada cliente recebe uma **chave de licença** (texto que começa com `DSP1.`) assinada com a **chave privada da agência**.
- O app tem só a chave **pública**: confere a assinatura sem internet. Ninguém consegue criar ou editar uma licença.
- A chave diz o cliente, o **plano**, os **módulos**, quantos **números de WhatsApp** e a **validade**.

| Situação | O que o cliente pode usar |
|---|---|
| Sem licença | Só **Conversas**, 1 número |
| Ativa | Tudo do plano. Nos últimos 7 dias aparece o aviso "vence em X dias" |
| Vencida há até 7 dias | Tudo do plano, com aviso para renovar |
| Vencida há mais de 7 dias | Só **Conversas**. Campanhas param e continuam de onde pararam quando renovar. Os dados nunca ficam presos |

Planos: **Básico** (Conversas) · **Marketing** (+ Campanhas, Anti-bloqueio, Lembretes, Respostas automáticas e Grupos) · **Completo** (+ Vendas e IA).

## Emitir uma licença
```bash
cd ~/Documents/Repositórios/Automacao_Otica
# mensal (vence em 1 mês a partir de hoje)
node scripts/licenca.mjs emitir --cliente "Ótica Visão Centro" --documento 12.345.678/0001-90 --plano completo --contas 1 --meses 1
# anual
node scripts/licenca.mjs emitir --cliente "Ótica Visão Centro" --plano marketing --contas 2 --meses 12
# data exata
node scripts/licenca.mjs emitir --cliente "Ótica Visão Centro" --plano basico --validade 2026-12-31
# conferir uma chave
node scripts/licenca.mjs ver DSP1....
```
Mande a chave para o cliente (WhatsApp ou e-mail). Ele cola em **Configurações → Licença → Ativar**. **Renovar** é emitir uma chave nova com validade maior; o cliente cola por cima.

Tudo que é emitido fica registrado em `~/.config/disparador/licencas-emitidas.csv`, com cliente, plano, validade e chave.

## ⚠️ A chave privada
- Fica em `~/.config/disparador/licenca-privada.pem` (só o seu usuário lê).
- **Faça backup agora**, num lugar seguro e offline: um pendrive ou o seu gerenciador de senhas.
  - Se ela se perder, você não consegue mais emitir nem renovar licenças. Teria que gerar outra e mandar uma versão nova do app para todos.
  - Se ela vazar, qualquer pessoa pode emitir licenças.
- **Nunca** coloque no git, no Drive compartilhado nem no app. Na automação de vendas pela Netlify, ela vai como **variável de ambiente secreta**.
