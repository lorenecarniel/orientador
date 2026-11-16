# OrientaDor — Painel profissional e atendimento inteligente

## Entregas desta versão
- Painel administrativo em `atendimento/index.html`.
- Login, cadastro por e-mail/senha, recuperação de senha e logout via Supabase Auth.
- Área interna protegida por sessão autenticada.
- Tela **Meu perfil**, com leitura e atualização do cadastro profissional no Supabase.
- Criação automática de perfil após cadastro de usuário, por trigger no banco.
- Biblioteca de templates e construtor inicial de fluxos.
- Telas iniciais de conversas, canais e configurações.

## Configuração do Supabase

O arquivo `supabase-config.js` contém apenas a Project URL e a publishable key pública. Nunca adicione `service_role`, secret keys ou a senha do banco ao repositório.

### Aplicar as migrations
No Supabase, abra **SQL Editor → New query** e execute os arquivos nesta ordem:

1. `supabase/migrations/001_chatbot.sql`
2. `supabase/migrations/002_professional_profiles.sql`

A segunda migration cria `professional_profiles`, ativa RLS e cria automaticamente o perfil quando uma conta é cadastrada no Supabase Auth. Se a migration 001 já tiver sido aplicada, execute somente a 002.

### URLs de autenticação
Em **Authentication → URL Configuration**, configure a Site URL e inclua os endereços de desenvolvimento e produção em Redirect URLs. Para testar, sirva a pasta `atendimento` por HTTP(S); não abra o HTML diretamente por `file://`.

## Como testar o perfil
1. Publique/execute o painel em um endereço HTTP(S) permitido.
2. Crie uma conta pela opção **Criar cadastro**.
3. Confirme o e-mail se a confirmação estiver habilitada.
4. Entre no painel e abra **Meu perfil**.
5. Preencha os dados e salve. O perfil é vinculado ao ID da conta autenticada.

## Limites desta entrega
O painel e a autenticação estão implementados, e o módulo de perfil está pronto para usar a migration 002. Ainda não há integração real com agenda, cadastro de pacientes, WhatsApp, motor de execução do chatbot ou publicação de fluxos. Os rascunhos do construtor permanecem locais no navegador.

## Segurança e próximos passos
- As políticas RLS do perfil permitem que cada profissional leia e edite somente o próprio registro.
- O ID do perfil é o mesmo UUID da conta em `auth.users`.
- Dados de saúde e dados de pacientes não devem ser adicionados até implementarmos os controles de privacidade, consentimento, auditoria e retenção.
- Tokens da Meta e chaves secretas devem ficar em Supabase Edge Function Secrets, nunca no frontend.
