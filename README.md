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
src/
├── auth/         # Autenticação e autorização
├── users/        # Perfil da usuária
├── cycles/       # Registro e predição de ciclo menstrual
├── symptoms/     # Sintomas diários
├── moods/        # Humor diário
├── flow/         # Intensidade do fluxo
├── notes/        # Notas livres
├── health/       # Temperatura, peso, água, atividade, sono
├── medications/  # Medicamentos e suplementos
└── notifications/# Configurações de notificações

## Convenções

- Branches: `username/BED-{id}-short-description`
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)
- Todo PR precisa de aprovação antes de mergear na `main`
- `develop` é a branch de integração

## Decisões de arquitetura

- **Multirepo:** backend e mobile em repositórios separados, contrato via API REST
- **Supabase como DBaaS:** banco gerenciado, sem overhead de infraestrutura
- **Prisma 7:** configuração via `prisma.config.ts`, sem `url` no schema
- **NestJS:** arquitetura modular, escalável para o sistema de monitoramento no Cycle 2