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

## Serviço de IA

O backend conversa com o microsserviço Python/FastAPI por `AI_SERVICE_URL`. O cliente HTTP usa timeout configurável em `AI_SERVICE_TIMEOUT_MS` e traduz falhas externas em exceptions controladas, para que upload, alerta e mobile não dependam de erro bruto do serviço de IA.
