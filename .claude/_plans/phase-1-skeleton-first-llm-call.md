# Plan: Phase 1 — Skeleton and First LLM Call

## Context
This is the first active phase of the EXSIM Question Engine. The goal is to wire up a single `POST /generator/one` endpoint that calls GPT-4o via the Vercel AI SDK and returns a typed, Zod-validated question object. No database writes, no queue, no deduplication — just proving the LLM round-trip works with schema validation.

The project already has: NestJS 11, Zod 4, ConfigModule with Azure OpenAI env vars, Langfuse, Pino logging. What's missing: the Vercel AI SDK packages, a ZodValidationPipe, the generator module, and a shared Question schema.

---

## Step 1 — Install packages

```bash
yarn add ai @ai-sdk/azure
```

- `ai` — Vercel AI SDK core (`generateObject`)
- `@ai-sdk/azure` — Azure OpenAI provider for the SDK

---

## Step 2 — Create ZodValidationPipe

**New file: `src/common/pipes/zod-validation.pipe.ts`**

A `PipeTransform` that accepts a Zod schema, calls `.parse()` on the incoming value, and throws `BadRequestException` with Zod's formatted errors on failure.

**Update: `src/common/pipes/index.ts`**  
Export `ZodValidationPipe` from the new file.

---

## Step 3 — Define the shared Question schema

**New file: `src/shared/schemas/question.schema.ts`**

```
questionSchema = z.object({
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  // TODO: add maxTokens budget guard when cost controls are introduced
})
```

Reuse `questionDifficultySchema` from `src/db/schemas/question.schema.ts` — it already defines `z.enum(['High', 'Medium', 'Low'])`.

Export `TQuestion = z.infer<typeof questionSchema>`.

**Update: `src/shared/schemas/index.ts`**  
Export from `question.schema.ts`.

---

## Step 4 — Create the Generator module

### 4a. Request schema
**New file: `src/modules/generator/schemas/generate-one.schema.ts`**

```
generateOneSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  difficulty: questionDifficultySchema,   // reuse from db/schemas
})
```

Export `TGenerateOneInput = z.infer<typeof generateOneSchema>`.

**New file: `src/modules/generator/schemas/index.ts`** — barrel export.

### 4b. Types
**New file: `src/modules/generator/types/generator.types.ts`**  
Re-export `TGenerateOneInput` and `TQuestion` (imported from shared) — no manual type definitions.

### 4c. Service
**New file: `src/modules/generator/services/generator.service.ts`**

- Injectable service that injects `ConfigService`.
- In the constructor, build the Azure provider once:
  ```
  createAzure({ baseURL: endpoint, apiKey: key })
  ```
- Single public method `generateOne(params: TGenerateOneInput): Promise<TQuestion>`:
  - Builds a prompt from subject/topic/difficulty.
  - Calls `generateObject({ model, schema: questionSchema, prompt })`.
  - Returns `result.object` (already typed as TQuestion).
  - Wraps the call in try/catch; rethrows as a plain `Error` — the controller handles HTTP mapping.

### 4d. Controller
**New file: `src/modules/generator/controllers/generator.controller.ts`**

- `POST /generator/one`
- Applies `ZodValidationPipe(generateOneSchema)` via `@UsePipes` on the handler.
- Calls `generatorService.generateOne(body)`.
- On success: returns the question object (NestJS sends 200 by default).
- On error: throws `InternalServerErrorException` with a safe message (no raw LLM error leakage).

### 4e. Module
**New file: `src/modules/generator/generator.module.ts`**  
Declares `GeneratorController`, provides `GeneratorService`. No extra imports needed — `ConfigModule` is global.

**New file: `src/modules/generator/index.ts`** — barrel export of the module.

---

## Step 5 — Wire into AppModule

**Update: `src/app.module.ts`**  
Add `GeneratorModule` to the `imports` array.

**Update: `src/modules/index.ts`**  
Add `GeneratorModule` export.

---

## Step 6 — Unit tests

**New file: `src/modules/generator/services/generator.service.spec.ts`**

| Test | What it does |
|---|---|
| Happy path | Mock `generateObject` → return valid question; assert service returns it |
| Schema violation | Mock `generateObject` → throw; assert error propagates |
| Controller 200 | Mock `generateOne` → valid question; assert HTTP 200 + body |
| Controller 500 | Mock `generateOne` → throw; assert HTTP 500 |

No integration tests in this phase — no database involved.

---

## Critical files

| Action | Path |
|---|---|
| Create | `src/common/pipes/zod-validation.pipe.ts` |
| Update | `src/common/pipes/index.ts` |
| Create | `src/shared/schemas/question.schema.ts` |
| Update | `src/shared/schemas/index.ts` |
| Create | `src/modules/generator/schemas/generate-one.schema.ts` |
| Create | `src/modules/generator/schemas/index.ts` |
| Create | `src/modules/generator/types/generator.types.ts` |
| Create | `src/modules/generator/services/generator.service.ts` |
| Create | `src/modules/generator/services/generator.service.spec.ts` |
| Create | `src/modules/generator/controllers/generator.controller.ts` |
| Create | `src/modules/generator/generator.module.ts` |
| Create | `src/modules/generator/index.ts` |
| Update | `src/app.module.ts` |
| Update | `src/modules/index.ts` |

Reuse:
- `questionDifficultySchema` from `src/db/schemas/question.schema.ts`
- `ConfigService` (global, no extra imports)
- `LangfuseService` from `src/shared/services/langfuse.service.ts` (optional trace wiring — defer to Phase 9)

---

## Verification

1. `yarn add ai @ai-sdk/azure` succeeds
2. `yarn build` — no TypeScript errors
3. `yarn test` — all new spec tests pass
4. `yarn start:dev` — app boots, no env var errors
5. Manual: `POST /generator/one` with `{ "subject": "Mathematics", "topic": "Algebra", "difficulty": "Medium" }` → 200 with a valid question object
6. Manual: `POST /generator/one` with missing `subject` → 400 with Zod error message
