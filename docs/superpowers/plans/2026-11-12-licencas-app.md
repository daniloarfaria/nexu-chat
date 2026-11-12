# Licenças por conta no aplicativo — execução aprovada

1. Alinhar contrato com site: login sem licenseId retorna seleção para múltiplas licenças efetivas, sem sessão/chave; com uma licença mantém ativação automática; segundo login informa licenseId.
2. Backend valida lista e licença assinada selecionada, preserva uma única quota, protege respostas concorrentes e renova somente a sessão/licença escolhida. Credenciais não são persistidas nem registradas.
3. UI escolhe plano/ID/limite/validade e permite trocar sem sair antes da confirmação. Senha só em estado do componente até escolher, cancelar ou errar. Testes isolados de servidor e smoke Electron com IPC simulado.

Validação: tests/license-online.test.ts cobre seleção, fluxo legado, quota única, resposta divergente, revogação, seleção obrigatória e concorrência. tests/e2e/license-selection.mjs não chama servidor nem usa credenciais reais. Sem mudanças de identidade do computador ou sessões WhatsApp nesta frente.
