---
name: NestJS Project Architecture Guideline (Zod)
description: Defines backend architecture using NestJS with Zod for validation and type inference. All code must follow this for consistency and scalability.
---

## App Architecture (Mandatory Structure)

All source code must follow this directory structure:

src/
│
├── main.ts
├── app.module.ts
│
├── config/
│   ├── app.config.ts
│   ├── database.config.ts
│   └── index.ts
│
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── pipes/
│   │   └── zod-validation.pipe.ts   # custom Zod pipe
│   └── constants/
│
├── modules/
│   ├── user/
│   │   ├── controllers/
│   │   │   └── user.controller.ts
│   │   │
│   │   ├── services/
│   │   │   └── user.service.ts
│   │   │
│   │   ├── schemas/                # Zod schemas (SOURCE OF TRUTH)
│   │   │   ├── user.schema.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── types/                  # inferred types ONLY
│   │   │   └── user.types.ts
│   │   │
│   │   ├── entities/               # ORM models
│   │   │   └── user.entity.ts
│   │   │
│   │   ├── repositories/
│   │   │   └── user.repository.ts
│   │   │
│   │   ├── user.module.ts
│   │   └── index.ts
│   │
│   └── auth/
│
├── shared/
│   ├── schemas/                   # reusable schemas (pagination, etc.)
│   ├── types/
│   ├── services/
│   └── modules/
│
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── database.module.ts
│
├── utils/                         # pure helpers ONLY
├── types/                         # global types (rare use)
├── assets/
│
└── tests/

---

# Core Principle: Zod = Single Source of Truth

## Mandatory Rules

- Zod schemas define:
  - Validation
  - Request/response structure
  - Types (via inference)

- DTO classes are **NOT allowed**

### ❌ Bad
```ts
class CreateUserDto {}
const schema = z.object({...});

✅ Good
export const createUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});
```

## Type Inference Pattern (Mandatory)
All types MUST be inferred from Zod schemas.
```ts
mport { z } from "zod";

export const createUserSchema = z.object({
  name: z.string(),
});

export type TCreateUser = z.infer<typeof createUserSchema>;
```

## Module-Level Schemas
```
modules/user/schemas/
├── user.schema.ts
└── index.ts
```

## Shared Schemas
```
shared/schemas/
├── pagination.schema.ts
├── id.schema.ts
```

## Schema Composition (Recommended)
``` 
export const baseUserSchema = z.object({
  name: z.string(),
});

export const createUserSchema = baseUserSchema.extend({
  email: z.string().email(),
});
```

## Barrel Export Pattern (Mandatory)
```ts
export * from "./user.module";
export * from "./services/user.service";
export * from "./schemas";
```

## Naming Conventions
Types & Interfaces
```ts
type TUser = {
  id: number;
};

interface IUser {
  id: number;
}
```

**IMPORTANT**
🚫 Strict Rules (Very Important)
❌ No class-validator
❌ No DTO Classes
❌ No duplicate types
❌ No business logic in controllers
❌ No DB queries in controllers
❌ No cross-module tight coupling
❌ No utility logic inside services