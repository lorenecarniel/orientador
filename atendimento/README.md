# OrientaDor — Atendimento inteligente (v1)

## O que foi criado
- Painel administrativo inicial em `atendimento/index.html`.
- Navegação: visão geral, conversas, templates, construtor, canais e configurações.
- Biblioteca inicial de templates para saúde.
- Construtor de blocos em sequência com edição de título e conteúdo.
- Simulação visual da arquitetura e pontos de integração.
- Migration inicial Supabase em `supabase/migrations/001_chatbot.sql`.

## Como testar
Abra `atendimento/index.html` em um navegador ou publique o diretório no GitHub Pages.
Os rascunhos e configurações desta primeira versão são salvos em localStorage do navegador.

## Limites desta entrega
Esta é uma primeira versão navegável do painel e do construtor, não um chatbot em produção. Ainda não envia mensagens pelo WhatsApp, não grava no Supabase e não cria agendamentos reais. As telas identificam esses pontos como não conectados/demonstrativos.

## Próximas implementações
1. Integrar autenticação e dados do profissional com o Supabase existente.
2. Criar motor de execução de fluxos (estado da conversa, nós, transições e variáveis).
3. Criar Edge Functions para webhook e envio de mensagens da Meta.
4. Implementar widget web e sessão pública segura.
5. Integrar agenda e cadastro de pacientes.
6. Adicionar testes, logs, consentimentos e políticas de retenção.

## Supabase
Revise a migration antes de aplicar. Ela pressupõe, provisoriamente, que o profissional autenticado possa ser identificado por `auth.uid()`. A associação com o modelo real de profissionais do OrientaDor deve ser ajustada antes de produção. Nunca exponha `service_role` ou tokens da Meta no navegador.
