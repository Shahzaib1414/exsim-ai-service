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
yarn test:debug        # Run single test with debugger attached
yarn test:e2e          # Run end-to-end tests (jest config: test/jest-e2e.json)
```

**Single Test File**
```bash
yarn test -- src/modules/user/user.service.spec.ts
```

## Architecture Overview

This is a **NestJS application** built with TypeScript, following a strict modular architecture with Zod for validation and type safety.

### Core Structure

```
src/
├── main.ts                  # Application entry point
├── app.module.ts            # Root module
├── config/                  # Configuration (app.config, database.config)
├── common/                  # Shared utilities: decorators, filters, guards, interceptors, pipes, constants
├── modules/                 # Feature modules (user, auth, etc.)
│   └── [module-name]/
│       ├── controllers/     # HTTP route handlers
│       ├── services/        # Business logic
│       ├── schemas/         # Zod schemas (SOURCE OF TRUTH for validation & types)
│       ├── types/           # Inferred types from schemas only
│       ├── entities/        # ORM models
│       ├── repositories/    # Data access layer
│       ├── [module].module.ts
│       └── index.ts         # Barrel exports
├── shared/                  # Reusable schemas, types, services across modules
├── database/                # Migrations, seeds, database module
├── utils/                   # Pure helper functions only
└── tests/                   # Test utilities and helpers
```

### Key Architecture Principles

**1. Zod = Single Source of Truth**
- Zod schemas define validation, request/response structure, and types
- Types are **inferred** from schemas using `z.infer<typeof schema>`
- **NO DTO classes** — schemas replace them entirely
- Use barrel exports from `schemas/index.ts` for module exports

**2. Module Organization**
Each feature module is self-contained with:
- **Controllers** — HTTP handlers only, no business logic
- **Services** — Business logic and orchestration
- **Repositories** — Database queries only
- **Schemas** — Zod validation schemas for all inputs/outputs
- **Types** — Inferred types (prefix with `T`: `TUser`, `TCreateUser`)
- **Entities** — ORM model definitions

**3. Strict Naming Conventions**
- Types: `TUser`, `TCreateUser`, `TUpdateUser`
- Interfaces: `IUser`, `IUserService`
- Schemas: `createUserSchema`, `updateUserSchema`, `baseUserSchema`
- Services: `UserService`
- Controllers: `UserController`
- Repositories: `UserRepository`

**4. Non-Negotiable Rules**
- ❌ No `class-validator` — use Zod only
- ❌ No DTO classes — Zod schemas are DTOs
- ❌ No business logic in controllers
- ❌ No database queries in controllers
- ❌ No tight coupling between modules
- ❌ No utility logic in services (use `utils/` folder)

### Schema Composition Pattern

```typescript
// modules/user/schemas/user.schema.ts
import { z } from 'zod';

export const baseUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

export const createUserSchema = baseUserSchema;
export const updateUserSchema = baseUserSchema.partial();
export const userResponseSchema = baseUserSchema.extend({
  id: z.number(),
  createdAt: z.date(),
});

export type TUser = z.infer<typeof userResponseSchema>;
export type TCreateUser = z.infer<typeof createUserSchema>;
```

### Custom Zod Validation Pipe

A custom validation pipe is implemented at `src/common/pipes/zod-validation.pipe.ts` for automatic schema validation in route handlers. Use it with `@UsePipes()` decorator or globally.

## Development Workflow

1. **Create a new module** — Use NestJS schematics or create the folder structure manually following the mandatory structure
2. **Define schemas first** — Write Zod schemas in `modules/[name]/schemas/[name].schema.ts`
3. **Infer types** — Generate types from schemas, never define them manually
4. **Implement repositories** — Database access layer with queries
5. **Implement services** — Business logic that uses repositories
6. **Implement controllers** — HTTP handlers that use services
7. **Test** — Write specs matching your implementation

## Environment & Port Configuration

The application listens on port `3000` by default. Override with the `PORT` environment variable:
```bash
PORT=3001 yarn start
```

## Testing Strategy

- **Unit tests** — Test individual services, repositories, and utilities
- **E2E tests** — Test full HTTP request/response cycles via the controller
- Test files use `.spec.ts` suffix
- Jest is configured with `ts-jest` for TypeScript support

## Pre-commit Hooks

Husky is configured with pre-commit hooks. Commits must pass linting and formatting checks. If a hook fails, fix the issue and retry.
