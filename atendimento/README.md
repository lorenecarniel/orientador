# OrientaDor — Atendimento inteligente (v1)

## O que foi criado
- Painel administrativo inicial em `atendimento/index.html`.\n- Tela de login, cadastro por e-mail/senha, recuperação de senha e logout via Supabase Auth.\n- Bloqueio da área interna enquanto não houver sessão autenticada.
- Navegação: visão geral, conversas, templates, construtor, canais e configurações.
- Biblioteca inicial de templates para saúde.
- Construtor de blocos em sequência com edição de título e conteúdo.
- Simulação visual da arquitetura e pontos de integração.
- Migration inicial Supabase em `supabase/migrations/001_chatbot.sql`.

## Configuração Supabase\n\nO arquivo `supabase-config.js` contém apenas a Project URL e a publishable key pública do projeto OrientaDor. O painel inicializa o SDK `supabase-js` no navegador, mas ainda não consulta nem grava tabelas. A publishable key só é segura no frontend quando as políticas RLS estiverem corretamente aplicadas. Nunca adicionar `service_role`, secret keys ou senha do banco a este repositório.\n\n## Autenticação\n\nO painel usa Supabase Auth com e-mail e senha. Configure em Authentication → URL Configuration os endereços de redirecionamento permitidos para o ambiente local e para o domínio onde o painel será publicado. O fluxo de cadastro respeita a confirmação de e-mail definida no projeto. A autenticação já está integrada, mas ainda não existe perfil de profissional/tabela de associação com os cadastros de negócio do OrientaDor.\n\n## Como testar
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
