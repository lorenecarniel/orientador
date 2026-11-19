# Configuração da ingestão da biblioteca de conhecimento

## O que esta etapa entrega

- Extrai texto de arquivos PDF com texto selecionável, DOCX e TXT.
- Combina o texto extraído com o texto livre enviado no campo de ensino.
- Divide o conteúdo em trechos e gera embeddings com `text-embedding-3-small`.
- Persiste os trechos e vetores em `knowledge_chunks`.
- Permite busca semântica apenas em fontes com status editorial `approved` e processamento `processed`.
- Mantém os arquivos no bucket privado `knowledge-library`.

## Pré-requisitos

1. Executar `supabase/migrations/029_knowledge_ingestion.sql` no SQL Editor do projeto Supabase.
2. Configurar uma chave de API da OpenAI como secret do Supabase. Nunca colocar essa chave no HTML ou no repositório.
3. Fazer deploy da Edge Function.

## Configurar a chave

No terminal com Supabase CLI autenticado:

```bash
supabase secrets set OPENAI_API_KEY=SUA_CHAVE_OPENAI --project-ref dxejugiflvijsnvlnglh
```

A chave é usada exclusivamente pela Edge Function para gerar embeddings. O modelo utilizado é `text-embedding-3-small`.

## Publicar a função

```bash
supabase functions deploy process-knowledge-source --project-ref dxejugiflvijsnvlnglh
```

A função exige JWT válido e confirma novamente o papel `admin` no banco. A chave `service_role` permanece apenas nos secrets gerenciados pelo Supabase.

## Fluxo de uso

1. Enviar texto livre e/ou anexar PDF, DOCX ou TXT na Biblioteca de conhecimento.
2. Enviar para revisão.
3. Aprovar editorialmente.
4. Clicar em **Processar para IA**.
5. A tela mostra o estado da indexação: não processado, processando, indexado ou falha.

## Limitações conhecidas

- PDFs digitalizados como imagem precisam de OCR; esta versão informa quando não consegue extrair texto suficiente.
- O processamento não valida a qualidade científica do conteúdo. A revisão humana continua obrigatória.
- A busca semântica está disponível por meio da RPC `match_knowledge_chunks`, mas ainda precisa ser conectada à geração do relatório educativo do paciente.
- Não enviar dados identificáveis de pacientes para a biblioteca. Ela deve conter materiais de referência, protocolos e conhecimento geral.
