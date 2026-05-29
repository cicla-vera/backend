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

## SMS de emergência

O envio de SMS usa `EMERGENCY_SMS_PROVIDER=mock` por padrão em desenvolvimento/testes, sem chamada externa. Para envio real, configure `EMERGENCY_SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_FROM_PHONE_NUMBER`; tokens nunca devem aparecer em logs, respostas ou commits.

Quando uma sessão Vera entra em `CRITICAL`, o backend dispara automaticamente os contatos ativos com uma mensagem segura em português, orientação para acionar polícia/emergência local e localização aproximada quando disponível. O dispatch é idempotente por contato: contatos já notificados não recebem duplicatas em novas tentativas, e nenhum áudio, transcrição, foto, vídeo ou arquivo bruto é enviado para terceiros.

## Serviço de IA

O backend conversa com o microsserviço Python/FastAPI por `AI_SERVICE_URL`. O cliente HTTP usa timeout configurável em `AI_SERVICE_TIMEOUT_MS` e traduz falhas externas em exceptions controladas, para que upload, alerta e mobile não dependam de erro bruto do serviço de IA.

Para analisar áudio, o backend baixa a evidência do Storage privado, confere o hash salvo e envia o conteúdo ao `ai-service` como `storageReference` em `data:` URL. A resposta `audio-evidence-v1` é persistida com estados `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED` ou `INCONCLUSIVE`, além de transcrição, eventos acústicos, `riskLevel`, `recommendedAction`, metadados do provider e motivo seguro de falha. O conteúdo bruto da evidência não é retornado para contatos de emergência nem gravado em eventos de timeline.

Quando a análise concluída sugere escalonamento crítico, o backend aplica uma política conservadora antes de mudar a sessão para `CRITICAL`. Por padrão, exige confiança mínima `0.78` e sinais fortes como ameaça concreta, agressão verbal criminosa, impacto físico, gritos/choro/pedido de socorro combinados ou recorrência recente. A decisão grava um evento `ALERT_ESCALATED` com motivos auditáveis, sem transcrição bruta. Os thresholds podem ser ajustados por `VERA_AI_CRITICAL_*` no `.env`.

Endpoints úteis:

- `POST /vera/alert-sessions/:alertSessionId/evidence/:id/analyze` inicia a análise síncrona de uma evidência de áudio.
- `GET /vera/alert-sessions/:alertSessionId/evidence/:id/analysis/latest` retorna o estado mais recente salvo para o mobile consultar.
- `POST /vera/alert-sessions/:id/location-samples` registra uma amostra ou lote de até 50 localizações consentidas durante sessão ativa. Cada item aceita `latitude`, `longitude`, `capturedAt`, `source`, `accuracyMeters` e `evidenceRecordId` opcional.
- `GET /vera/alert-sessions/:id/location-samples?limit=100` lista a trilha da sessão em ordem cronológica segura para o app.
