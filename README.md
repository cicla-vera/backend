# Cicla Vera — Backend

API REST do aplicativo Cicla Vera, construída com NestJS + TypeScript.

## Stack

- **Framework:** NestJS 11
- **Linguagem:** TypeScript
- **Banco de dados:** PostgreSQL (Supabase)
- **ORM:** Prisma 7
- **Autenticação:** JWT
- **Validação:** class-validator + class-transformer
- **Filas:** Redis + BullMQ (Cycle 2)
- **Deploy:** Railway (dev) → AWS (prod)

## Pré-requisitos

- Node.js 22+
- npm

## Instalação

```bash
git clone https://github.com/cicla-vera/backend.git
cd backend
npm install
cp .env.example .env
# preencha as variáveis do .env
npm run start:dev
```

## Ambiente local

O backend escuta em `HOST=0.0.0.0` por padrão para facilitar testes com
Expo, celular físico, emuladores e WSL. O prefixo global da API é `/api`.

Para web local, o backend habilita CORS em desenvolvimento quando
`CORS_ORIGINS` está vazio. Em ambientes compartilhados/prod, use uma allowlist:

```env
PORT=3001
HOST=0.0.0.0
CORS_ORIGINS=http://localhost:8081,http://localhost:19006
```

No BlueStacks, `10.0.2.2` aponta para o host Windows. Se o backend estiver no
WSL, mantenha o backend escutando em `0.0.0.0` e preserve o encaminhamento de
porta Windows/WSL que expõe a porta `3001` para o host.

## Estrutura de módulos

Estrutura atual:

```text
src/
|-- main.ts
|-- app.module.ts
|-- app.controller.ts
|-- app.service.ts
`-- app.controller.spec.ts
```

Novos domínios devem ser organizados como módulos próprios dentro de `src/`:

```text
src/
`-- <domain>/
    |-- <domain>.module.ts
    |-- <domain>.controller.ts
    |-- <domain>.service.ts
    |-- dto/
    `-- entities/
```

Exemplos de domínios previstos: `auth`, `users`, `cycles`, `symptoms`, `moods`, `flow`, `notes`, `health`, `medications` e `notifications`.

## Convenções

- Branches: `username/BED-{id}-short-description`
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)
- Todo PR precisa de aprovação antes de mergear na `main`
- `develop` é a branch de integração

## Decisões de arquitetura

- **Multirepo:** backend e mobile em repositórios separados, contrato via API REST
- **Supabase como DBaaS:** banco gerenciado, sem overhead de infraestrutura
- **Supabase Storage no MVP:** evidências ficam em bucket privado (`SUPABASE_STORAGE_BUCKET`, padrão `vera-evidence`) acessado pelo backend com `SUPABASE_SERVICE_ROLE_KEY`
- **Prisma 7:** configuração via `prisma.config.ts`, sem `url` no schema
- **NestJS:** arquitetura modular, escalável para o sistema de monitoramento no Cycle 2

## Supabase Storage

Para o MVP de evidências, crie um bucket privado no Supabase Storage chamado `vera-evidence` ou ajuste `SUPABASE_STORAGE_BUCKET` no `.env`.

O backend usa `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor para upload/download interno. Não exponha essa chave no mobile, no frontend, em logs ou em commits.

Evidências removidas pelo app são ocultadas da visão da usuária, mas o arquivo no Storage não é apagado imediatamente. O backend marca `hiddenFromUserAt` e agenda a retenção com `retentionUntil`; a exclusão definitiva via `deletedAt` fica preparada para um job administrativo futuro.

### Ingestão verificável de chunks de áudio

Uploads da fila do mobile usam `queuedEvidenceUploadId` como chave idempotente. Repetir o mesmo upload retorna o registro existente sem criar outra evidência; reutilizar o identificador para conteúdo diferente é rejeitado antes do envio ao Storage.

Chunks da sentinela de áudio formalizam `chunkSequenceId`, `chunkIndex`, `previousChunkHash` e `chunkChainStatus`. O backend recalcula o SHA-256, rejeita hash divergente e classifica cada elo como `ROOT`, `VERIFIED` ou `PENDING_PREVIOUS`. O estado pendente permite que pré-roll e retries cheguem fora de ordem; quando o chunk anterior chega, o próximo elo é reconciliado e recebe um evento de auditoria `CHUNK_CHAIN_VERIFIED`.

Após atualizar o backend, aplique a migração antes de testar uploads:

```bash
npx prisma migrate deploy
```

## Pacote tecnico de evidencia Vera

O backend prepara a exportacao futura por meio do servico interno `EvidenceExportService`, sem endpoint publico no MVP. O manifesto gerado inclui sessao Vera, hashes SHA-256 dos arquivos, metadados, eventos de timeline, amostras de localizacao, resultados de IA e eventos de auditoria encadeados por hash.

O manifesto calcula um `manifestHash` SHA-256 sobre os campos tecnicos antes de anexar o recibo de timestamp. Hoje o adapter de timestamp retorna explicitamente `UNTRUSTED_SYSTEM_CLOCK`, usando o relogio do servidor, ou `PROVIDER_ADAPTER_PENDING` quando `VERA_EVIDENCE_TIMESTAMP_PROVIDER` e configurado. Antes de afirmar timestamp confiavel, ainda e necessario implementar e validar um provedor RFC 3161 ou equivalente.

Essa camada fornece integridade tecnica e rastreabilidade, mas nao garante sozinha validade juridica. A admissibilidade depende de consentimento, cadeia operacional de custodia, politicas de acesso, revisao pericial e aceitacao pela autoridade competente.

## Mensagens de emergência

O envio usa `EMERGENCY_DISPATCH_CHANNELS=sms` por padrão. Para enviar por SMS e WhatsApp no mesmo acionamento, use `EMERGENCY_DISPATCH_CHANNELS=sms,whatsapp`. SMS usa `EMERGENCY_SMS_PROVIDER=mock` por padrão em desenvolvimento/testes, sem chamada externa. Para envio real por SMS, configure `EMERGENCY_SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_FROM_PHONE_NUMBER`.

Para WhatsApp via Twilio, configure `EMERGENCY_WHATSAPP_PROVIDER=twilio` e `TWILIO_WHATSAPP_FROM_PHONE_NUMBER`. O backend usa o mesmo endpoint de mensagens da Twilio com endereços `whatsapp:+...`. Em sandbox, o contato precisa ter entrado no sandbox; em produção, regras de janela/template do WhatsApp podem exigir templates aprovados para conversas iniciadas pelo app. Tokens nunca devem aparecer em logs, respostas ou commits.

Quando uma sessão Vera entra em `CRITICAL`, o backend dispara automaticamente os contatos ativos com uma mensagem segura em português, orientação para acionar polícia/emergência local e localização aproximada quando disponível. O dispatch é idempotente por contato: contatos já notificados não recebem duplicatas em novas tentativas, e nenhum áudio, transcrição, foto, vídeo ou arquivo bruto é enviado para terceiros.

## Push notifications

O backend envia push pelo Expo Push Service, sem segredo de servidor adicional. Para testar em desenvolvimento, use um dev build do mobile que gere um `ExpoPushToken`, registre o token em `POST /notifications/devices` e dispare `POST /notifications/test`. A Expo pode retornar tickets com erro `DeviceNotRegistered`; nesse caso o backend desativa o device para evitar novas tentativas com token inválido. Lembretes reais podem ser conferidos em `GET /notifications/reminders/preview` e disparados manualmente em `POST /notifications/reminders/send-due`.

## Verificacao de conta

O MVP trata verificacao de email e telefone como opcional: cadastro e login continuam funcionando, mas `emailVerifiedAt` e `phoneVerifiedAt` ficam disponiveis para o mobile mostrar status e incentivar confirmacao.

Endpoints autenticados:

- `GET /account-verification/status` retorna status de email e telefone, com telefone mascarado.
- `POST /account-verification/email/request` gera um codigo de 6 digitos para o email da conta.
- `POST /account-verification/email/confirm` confirma `{ "code": "123456" }`.
- `POST /account-verification/phone/request` gera um codigo para o telefone salvo no perfil.
- `POST /account-verification/phone/confirm` confirma `{ "code": "123456" }`.

Em desenvolvimento, o padrao e `ACCOUNT_VERIFICATION_PROVIDER=mock`, e o backend retorna `devCode` na resposta para testes locais sem custo. Em producao sem provider configurado, o adapter fica `disabled` e nao retorna codigo. Substitua por provider transacional de email e SMS/OTP antes de tornar a verificacao obrigatoria. Variaveis sugeridas para o proximo adapter real: `ACCOUNT_VERIFICATION_PROVIDER`, `ACCOUNT_EMAIL_FROM`, `ACCOUNT_EMAIL_PROVIDER_API_KEY`, `ACCOUNT_SMS_FROM` e credenciais do provedor SMS escolhido.

## Cadastro e perfil

O cadastro normaliza email para minusculas, nome, telefone brasileiro e CPF antes de persistir. Telefones aceitam formatos locais ou com `+55`, mas sao armazenados apenas com os 10 ou 11 digitos nacionais. CPF e validado pelos digitos verificadores, data de nascimento nao pode estar no futuro e conflitos de email/CPF retornam erro controlado sem registrar dados sensiveis em logs.

`GET /users/me` e `PATCH /users/me` incluem `name`, `phone`, `birthDate`, `cpf`, `avgCycleLength` e `avgPeriodDuration`. As medias aceitas sao de 15 a 50 dias para o ciclo e de 1 a 15 dias para o periodo. Alterar o telefone remove `phoneVerifiedAt`; enviar o mesmo numero com outra formatacao preserva a verificacao.

No cadastro, `initialCycleData` aceita `lastPeriodDate`, `lastPeriodEndDate`, `avgCycleLength` e `avgPeriodDuration`. A regularidade nao e persistida como declaracao inicial: ela e derivada dos ciclos observados por `/cycles/history` e `/cycles/insights`.

Smoke recomendado: execute `npm run smoke:profile` e `npm run smoke:cycles` no repositorio mobile com este backend ativo.

## Regras de ciclos

Os endpoints de ciclos rejeitam `endDate` anterior a `startDate` e periodos que sobreponham outro registro da mesma usuaria. Um ciclo sem `endDate` e considerado aberto e impede a criacao de outro ciclo posterior ate ser fechado, corrigido ou removido.

`PATCH /cycles/:id` recalcula `duration` mesmo quando apenas uma das datas muda. Para reabrir um periodo marcado como encerrado, envie `{ "endDate": null }`; a operacao tambem e rejeitada se isso sobrepor um registro posterior.

Smoke manual recomendado:

1. Crie um ciclo aberto com `POST /cycles` e apenas `startDate`.
2. Feche-o com `PATCH /cycles/:id` enviando apenas `endDate` e confirme que `duration` foi calculada.
3. Tente criar um periodo sobreposto e confirme resposta `400`.
4. Reabra com `PATCH /cycles/:id` e `{ "endDate": null }`, depois remova com `DELETE /cycles/:id`.

## Serviço de IA

O backend conversa com o microsserviço Python/FastAPI por `AI_SERVICE_URL`. O cliente HTTP usa timeout configurável em `AI_SERVICE_TIMEOUT_MS` e traduz falhas externas em exceptions controladas, para que upload, alerta e mobile não dependam de erro bruto do serviço de IA.

Para analisar áudio, o backend enfileira uma solicitação idempotente por evidência e responde sem aguardar o provedor externo. Um worker durável baseado no banco baixa a evidência do Storage privado, confere o hash salvo e envia o conteúdo ao `ai-service` como `storageReference` em `data:` URL. Falhas transitórias usam retry exponencial e jobs `PROCESSING` abandonados são recuperados após o timeout de lock. A resposta `audio-evidence-v1` é persistida com estados `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED` ou `INCONCLUSIVE`, além de transcrição, eventos acústicos, `riskLevel`, `recommendedAction`, metadados do provider e motivo seguro de falha. O conteúdo bruto da evidência não é retornado para contatos de emergência nem gravado em eventos de timeline.

Quando a análise concluída sugere escalonamento crítico, o backend aplica uma política conservadora antes de mudar a sessão para `CRITICAL`. Por padrão, exige confiança mínima `0.78` e sinais fortes como ameaça concreta, agressão verbal criminosa, impacto físico, gritos/choro/pedido de socorro combinados ou recorrência recente. A decisão grava um evento `ALERT_ESCALATED` com motivos auditáveis, sem transcrição bruta. Os thresholds podem ser ajustados por `VERA_AI_CRITICAL_*` no `.env`.

Endpoints úteis:

- `POST /vera/alert-sessions/:alertSessionId/evidence/:id/analyze` enfileira a análise assíncrona de uma evidência de áudio e retorna `202 Accepted`.
- `GET /vera/alert-sessions/:alertSessionId/evidence/:id/analysis/latest` retorna o estado mais recente salvo para o mobile consultar.
- `POST /vera/alert-sessions/:id/location-samples` registra uma amostra ou lote de até 50 localizações consentidas durante sessão ativa. Cada item aceita `latitude`, `longitude`, `capturedAt`, `source`, `accuracyMeters` e `evidenceRecordId` opcional.
- `GET /vera/alert-sessions/:id/location-samples?limit=100` lista a trilha da sessão em ordem cronológica segura para o app.
