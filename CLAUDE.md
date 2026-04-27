# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

**Development**
```bash
yarn start          # Start server (port 3000 by default, configurable via PORT env var)
yarn start:dev      # Start with watch mode
yarn start:debug    # Start with debugger attached
```

**Building & Linting**
```bash
yarn build          # Compile TypeScript to dist/
yarn lint           # Fix ESLint violations
yarn format         # Format code with Prettier
```

**Testing**
```bash
yarn test                # Run all unit tests
yarn test:watch         # Run tests in watch mode
yarn test:cov          # Run tests with coverage report
yarn test:e2e          # Run end-to-end tests (jest config: test/jest-e2e.json)
```

**Single Test File**
```bash
yarn test -- src/modules/generator/services/generator.service.spec.ts
```

## Architecture Overview

This is a **NestJS + TypeScript** AI service that generates exam questions using Azure OpenAI (GPT-4o for generation, Ada for embeddings), stores embeddings in Postgres via Drizzle ORM, and forwards saved questions to an external .NET API.

### Actual Directory Structure

```
src/
├── main.ts / app.module.ts
├── config/              # Zod-validated env schema (TEnv), database config
├── common/
│   ├── interceptors/    # ValidationErrorInterceptor, header/path/query validators
│   ├── pipes/           # ZodValidationPipe
│   ├── services/        # BaseService (Drizzle helpers), LangfuseService
│   ├── modules/         # ObservabilityModule
│   └── types/           # Shared Zod schemas + inferred types (QuestionSchema, etc.)
├── contracts/           # ts-rest API contracts (generatorContract)
├── db/
│   ├── client.ts        # createDrizzleClient(), DrizzleClient type
│   ├── schemas/         # Drizzle table definitions (source of truth for DB shape)
│   └── index.ts
├── database/
│   └── database.module.ts  # Provides DRIZZLE_CLIENT token
├── modules/
│   ├── generator/       # LLM question generation (orchestrates embedding + question)
│   ├── embedding/       # Azure embedding (abstract EmbeddingService + AzureEmbeddingService)
│   ├── question/        # HTTP client to external .NET Questions API
│   └── health/          # Health check endpoint
└── utils/               # Pure helpers (serializeError, etc.)
```

### Key Technologies & Patterns

**1. neverthrow for Error Handling**

All service methods return `Result<T, TErrorResult>` from `neverthrow` — never throw for expected failures:
```typescript
import { ok, err, Result } from 'neverthrow';

async doWork(): Promise<Result<TFoo, TErrorResult>> {
  try {
    return ok(value);
  } catch (error) {
    return err({ status: HttpStatus.INTERNAL_SERVER_ERROR, message: '...' });
  }
}
```

**2. BaseService for DB Access**

Services extend `BaseService` from `@/common/services`. Pass the Drizzle table for single-table helpers (`insertOne`, `findById`, `findOne`, `findMany`, `updateWhere`, `updateById`); omit it for multi-table orchestration:
```typescript
// Single-table
class FooService extends BaseService<typeof FooTable> {
  constructor(@Inject(DRIZZLE_CLIENT) db: DrizzleClient) { super(db, FooTable); }
}

// Multi-table orchestration (GeneratorService pattern)
class BarService extends BaseService {
  constructor(@Inject(DRIZZLE_CLIENT) db: DrizzleClient, ...) { super(db); }
}
```

**3. ts-rest Contracts**

API shape is defined in `src/contracts/` using `@ts-rest/core`. Controllers consume the contract; the `ValidationErrorInterceptor` in `common/interceptors/zod-validation.interceptor.ts` transforms ts-rest Zod errors into `BadRequestError` responses.

**4. Drizzle Schemas (DB Source of Truth)**

Database table definitions live in `src/db/schemas/`, not inside modules. All tables use PascalCase column names (e.g., `Id`, `QuestionId`, `Created`) matching the existing schema.

**5. Zod = Validation & Type Source of Truth**

Shared Zod schemas and inferred types live in `src/common/types/`. Module-level schemas go in `modules/[name]/schemas/`. Types are always inferred with `z.infer<typeof schema>` — never defined manually.

**6. `@/` Path Alias**

`@/` resolves to `src/`. Always use this alias for cross-directory imports.

### Required Environment Variables

Validated at startup via Zod (`src/config/app.config.ts`); the app refuses to start if any are missing:

```
DATABASE_URL, REDIS_URL
AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_RESOURCE
AZURE_OPENAI_DEPLOYMENT_GPT4O, AZURE_OPENAI_DEPLOYMENT_EMBEDDING
LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
APPLICATIONINSIGHTS_CONNECTION_STRING
DOTNET_API_URL          # External .NET API that persists questions
```

### Module Structure Convention

Each feature module follows:
```
modules/[name]/
├── controllers/[name].controller.ts
├── services/[name].service.ts
├── schemas/             # Zod schemas for request/response (if needed)
├── [name].module.ts
└── index.ts             # Barrel exports
```

No `repositories/` or `entities/` subfolders — services use `BaseService` directly with Drizzle tables from `src/db/schemas/`.

### Strict Rules

- ❌ No `class-validator` — Zod only
- ❌ No DTO classes — Zod schemas are DTOs
- ❌ No business logic in controllers
- ❌ No throwing errors for expected failures — use `neverthrow` Result
- ❌ No utility logic inside services — use `src/utils/`

## Pre-commit Hooks

Husky runs lint + format checks before every commit. Fix violations before retrying.
