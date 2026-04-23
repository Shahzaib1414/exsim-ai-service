# Plan: Phase 0 — Engine Project Setup

## Context

The `exsim-ai-service` NestJS repo is partially bootstrapped. Core dependencies and linting are in place, but several Phase 0 items from `_specs/phase-0-engine-setup.md` are missing. This plan implements all remaining pieces in the correct order so the project reaches its exit criteria: a developer can clone, install, and hit `/health` in under 15 minutes, with CI green.

**Branch:** `claude/feature/phase-0-engine-setup`

---

## Current State (from codebase exploration)

Already done:
- NestJS 11.0.1, Yarn, TypeScript (ES2023), ESLint 9.x, Prettier, Husky 9.x, Jest 30.x

Gaps to close:
- Husky hooks call `npm run ...` instead of `yarn`
- No `.nvmrc`
- No `commitlint` or `lint-staged`
- No `.env.example` or env validation
- No `@nestjs/config` or Zod config module
- No Drizzle ORM setup (CRUD only, no migrations)
- No health check endpoint
- No Pino logging
- No Langfuse / Application Insights
- No `docker-compose.yml` or `Dockerfile`
- No CI/CD pipeline
- `src/` is flat — needs the folder structure from spec

---

## Step 0 — Create Linear Ticket

Create one parent ticket in the Exsim AI project for tracking Phase 0:
- Create child tickets as well to distribute the work among team members 
- **Team ID:** `87068b37-fa5b-481d-b1cc-ac49e67ecec2`
- **Project ID:** `6c2353a9-245a-4671-9d78-50c8e71aa109`
- **Status:** In Progress (`f1d91165-c6f1-4771-b0ea-9527c277f53f`)
- **Title:** `Phase 0: Engine Project Setup`
- **Description:** Markdown checklist mirroring the spec's Acceptance Criteria (see spec file)

---

## Step 1 — Fix Husky Hooks

**File:** `.husky/pre-commit`  
Change all `npm run` calls to `yarn`:
```sh
yarn lint
yarn format
yarn test
```

---

## Step 2 — Add `.nvmrc`

Create `.nvmrc` at repo root:
```
20
```

---

## Step 3 — Add commitlint + lint-staged

**Install:**
```
@commitlint/cli @commitlint/config-conventional lint-staged
```

**Create:** `commitlint.config.js`
```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

**Add to `package.json`:**
```json
"lint-staged": {
  "*.ts": ["eslint --fix", "prettier --write"]
}
```

**Update `.husky/pre-commit`** to run lint-staged on staged files. Keep `yarn test`.

**Create `.husky/commit-msg`:**
```sh
yarn commitlint --edit "$1"
```

---

## Step 4 — Environment Configuration (ConfigModule + Zod)

**Install:** `@nestjs/config zod`

**Create `src/config/app.config.ts`** — Zod schema for `process.env`. App refuses to start if any required var is absent.

Required env vars:
- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — Redis connection string
- `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint
- `AZURE_OPENAI_KEY` — Azure OpenAI API key
- `AZURE_OPENAI_DEPLOYMENT_GPT4O` — GPT-4o model deployment name
- `AZURE_OPENAI_DEPLOYMENT_EMBEDDING` — text-embedding-3-small deployment name
- `NODE_ENV` (enum: development | test | production)
- `LOG_LEVEL` (enum: debug | info | warn | error)
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- `PORT` (optional, default 3000)

**Create `src/config/database.config.ts`** — exports `DATABASE_URL` as a config namespace.

**Create `src/config/index.ts`** — barrel export.

**Create `.env.example`** — every var listed with one-line description, no real values.

**Update `src/app.module.ts`** — import `ConfigModule.forRoot({ isGlobal: true, validate: zodValidate })`.

---

## Step 5 — Database Layer (Drizzle CRUD only)

**Install:** `drizzle-orm pg @types/pg`

> No `drizzle-kit` — migrations live in the other project.

**Create `src/db/schema.ts`** — Drizzle table definitions reflecting existing Postgres schema (from C# entities):
- `questions` table (id, statement, solution, imageUrl, topicId, parentQuestionId, status, audit columns)
- `question_tags` table (id, name, value, questionId, audit columns)
- `question_options` table (id, option, isCorrect, questionId, audit columns)

**Create `src/db/client.ts`** — Drizzle client using `pg.Pool` from `DATABASE_URL`.

**Create `src/db/index.ts`** — barrel export.

**Create `src/database/database.module.ts`** — NestJS module providing the Drizzle client as injectable token `DRIZZLE_CLIENT`.

---

## Step 6 — Health Check Endpoint

**Create `src/modules/health/health.controller.ts`** — `GET /health` returns:
```json
{ "status": "ok", "version": "0.0.1", "environment": "development" }
```

**Create `src/modules/health/health.module.ts`**

**Update `src/app.module.ts`** — import `HealthModule`.

---

## Step 7 — Pino Logging

**Install:** `nestjs-pino pino-http pino`

**Update `src/app.module.ts`** — import `LoggerModule.forRoot()` from `nestjs-pino`:
- `LOG_LEVEL` from config
- `genReqId` middleware attaches request ID to every log line
- Pretty-print in development, JSON in production

**Update `src/main.ts`** — set NestJS logger to `nestjs-pino`.

---

## Step 8 — Observability (Langfuse + Application Insights)

**Langfuse:**
- Install `langfuse`
- Create `src/shared/services/langfuse.service.ts` — initializes client from env vars, provided globally

**Application Insights:**
- Install `applicationinsights`
- Initialize in `src/main.ts` BEFORE `NestFactory.create()` to instrument the entire process

---

## Step 9 — Docker Compose + Dockerfile

**Create `docker-compose.yml`:**
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: ExsimDb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_password

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  langfuse:      # opt-in via: docker-compose --profile observability up
    profiles: ["observability"]
    image: langfuse/langfuse:latest
    ...
```

**Create multi-stage `Dockerfile`:**
1. `builder` — install all deps, compile TypeScript
2. `runner` — copy `dist/`, install production deps only, `node dist/main`

---

## Step 10 — CI/CD Pipeline

**Create `.github/workflows/ci.yml`:**
- Triggers: push to any branch, PR to `main`/`dev`
- Steps: checkout → setup Node 20 → yarn install → lint → typecheck → test → build

---

## Step 11 — Restructure `src/` to Match Spec

Create the target directory structure and empty barrel files:
```
src/
├── config/             ← Step 4
├── common/decorators, filters, guards, interceptors, constants
├── modules/health/     ← Step 6
├── shared/schemas, types, services   ← Langfuse Step 8
├── db/                 ← Step 5
├── utils/
└── types/
```

Keep `app.controller.ts` and `app.service.ts` at root — remove in Phase 1 when first real module is built.

---

## Verification

```bash
docker-compose up -d
yarn dev

curl http://localhost:3000/health
# → { "status": "ok", "version": "0.0.1", "environment": "development" }

yarn test    # all green
yarn lint    # no violations
yarn build   # compiles cleanly
```

Manual checks:
- Remove `DATABASE_URL` from `.env` → app refuses to start with a clear error
- Commit with bad message format → commitlint hook rejects it
- Push branch → GitHub Actions CI passes

---

## Files to Create / Modify

| Action | Path |
|--------|------|
| Modify | `.husky/pre-commit` |
| Create | `.nvmrc` |
| Create | `commitlint.config.js` |
| Create | `.husky/commit-msg` |
| Modify | `package.json` (add lint-staged config) |
| Create | `src/config/app.config.ts` |
| Create | `src/config/database.config.ts` |
| Create | `src/config/index.ts` |
| Create | `.env.example` |
| Modify | `src/app.module.ts` |
| Modify | `src/main.ts` |
| Create | `src/db/schema.ts` |
| Create | `src/db/client.ts` |
| Create | `src/db/index.ts` |
| Create | `src/database/database.module.ts` |
| Create | `src/modules/health/health.controller.ts` |
| Create | `src/modules/health/health.module.ts` |
| Create | `src/shared/services/langfuse.service.ts` |
| Create | `docker-compose.yml` |
| Create | `Dockerfile` |
| Create | `.github/workflows/ci.yml` |
| Create | Barrel `index.ts` files in all empty directories |
