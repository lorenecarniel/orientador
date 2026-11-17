# Google Agenda e Google Meet

## Configuração inicial

1. Aplique a migration `022_google_calendar_connections.sql` no Supabase.
2. Em Supabase → Edge Functions → Secrets, cadastre:
   - `GOOGLE_CLIENT_ID`: Client ID do OAuth Web criado no Google Cloud.
   - `GOOGLE_CLIENT_SECRET`: Client Secret do mesmo cliente OAuth.
   - `GOOGLE_CALENDAR_REDIRECT_URI`: `https://dxejugiflvijsnvlnglh.supabase.co/functions/v1/google-calendar-oauth-callback`
   - `GOOGLE_TOKEN_ENCRYPTION_KEY`: chave aleatória de 32 bytes codificada em Base64. Gere localmente com `openssl rand -base64 32`. Nunca use uma chave de exemplo nem compartilhe esse valor.
3. Faça deploy das Edge Functions:
   - `google-calendar-oauth-start`
   - `google-calendar-oauth-callback`
   - `google-calendar-status`
   - `google-calendar-create-event`
4. A função `google-calendar-oauth-callback` precisa aceitar chamadas sem JWT, pois é chamada pelo redirecionamento do Google. Essa exceção está registrada em `supabase/config.toml`. As demais funções validam o JWT do profissional.

## Fluxo implementado nesta etapa

- O profissional inicia o OAuth pela tela Configurações → Google Agenda e Meet.
- O backend gera e valida um state de uso único com validade de 10 minutos.
- O callback troca o código OAuth por tokens e armazena o pacote de tokens cifrado com AES-GCM.
- A chave de cifragem e o Client Secret ficam somente nos secrets das Edge Functions.
- A tabela de conexões não concede leitura aos papéis anon/authenticated; operações usam service role no backend.
- O status expõe apenas e-mail, data e escopos autorizados.
- A função de criação de evento solicita um link de videoconferência Meet com conferenceDataVersion=1.

## Próxima etapa

A função de criação de eventos está disponível como endpoint, mas ainda não foi conectada automaticamente ao fluxo de criação de agendamentos nem ao prontuário. Essa integração exige persistir o ID do evento e o link Meet no agendamento, tratar reagendamentos/cancelamentos e testar os estados de erro antes de ativar o fluxo para profissionais.
