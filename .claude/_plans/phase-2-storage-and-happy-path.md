# Phase 2: Storage and Happy Path

## Context

Phase 1 produced a working LLM round-trip (`POST /generator/one` → GPT-4o → typed question). Phase 2 wires that question into storage: generate → embed → call .NET to save the question → write embedding to `question_embeddings`.

**Key architectural decisions:**
- Questions/QuestionOptions are saved by calling the existing .NET API (`POST http://localhost:5001/Questions`) — no direct DB writes for those tables
- This service owns the embedding write to `question_embeddings` directly via Drizzle
- All 4 new tables (`question_embeddings`, `grounding_embeddings`, `batches`, `batch_items`) are defined and migrated by .NET — this service only defines Drizzle schemas for ORM access
- **No drizzle-kit, no migrations in this project**

---

## Package Changes

```bash
yarn add @nestjs/axios axios
```

No `drizzle-kit` or `testcontainers` schema migration tooling needed.

Add to `package.json` scripts (optional, for convenience):
```json
"db:push": "echo 'Migrations managed by .NET project'"
```

---

## .NET Endpoint Contract

`POST http://localhost:5001/Questions` (URL configurable via env var `DOTNET_API_URL`)

Request body:
```json
{
  "statement": "string",
  "solution": "string",
  "imageUrl": null,
  "options": [
    { "option": "string", "isCorrect": false },
    { "option": "string", "isCorrect": true },
    ...
  ],
  "childQuestions": [],
  "tags": [
    { "name": "test", "value": "Algebra" },
    { "name": "difficulty", "value": "Medium" },
    { "name": "type", "value": "Mcqs" }
  ]
}
```

Notes:
- `tags[0].name` is always the string `"test"` (constant) and `value` is the topic name
- `difficulty` and `type` are sent as additional tags matching the existing `QuestionTags` schema
- The .NET endpoint returns the created question (with `id: uuid`) — this `id` is stored in `question_embeddings.question_id`

Add `DOTNET_API_URL` to `src/config/app.config.ts` env validation.

---

## TQuestion → .NET Payload Mapping

`TQuestion { stem, options[4], correctAnswerIndex, explanation }` + input `{ topic, difficulty }` maps to:
- `statement` ← `stem`
- `solution` ← `explanation`
- `imageUrl` ← `null`
- `options[i]` ← `{ option: options[i], isCorrect: i === correctAnswerIndex }`
- `tags` ← `[{ name: 'test', value: topic }, { name: 'difficulty', value: difficulty }, { name: 'type', value: 'Mcqs' }]`

No `topicId` field needed in `GenerateOneSchema` — topic name is already in the schema.

---

## Database Schema Design

Define Drizzle schemas for type safety and ORM access. All tables live in `exsim_engine` schema (created by .NET migrations). **No migration generation from this project.**

### `exsim_engine.question_embeddings` — written by this service

```
id              uuid PK
question_id     uuid NOT NULL UNIQUE  (FK to Questions.Id, owned by .NET)
embedding       vector(1536) NOT NULL
model_name      text NOT NULL  ← for embedding drift detection
created_at      timestamp NOT NULL
```
Index: IVFFlat on `embedding` using `vector_cosine_ops`, `lists=100` (created by .NET migration).

### `exsim_engine.grounding_embeddings` — schema defined, not used in Phase 2

```
id, chunk_text, embedding vector(1536), model_name, source_doc, page_number, subject, topic, metadata jsonb, created_at
```

### `exsim_engine.batches` — schema defined, not used in Phase 2

```
id, subject, topic, difficulty, requested_count, status, created_by, created_at, updated_at
```

### `exsim_engine.batch_items` — schema defined, not used in Phase 2

```
id, batch_id FK→batches.id, question_id, status, attempt_count, error_message, created_at, updated_at
```

---

## Orchestration Flow

```
generateOne({ subject, topic, difficulty }):
  1. LLM call → Result<TQuestion>                          (existing, unchanged)
  2. Build: buildEmbeddingText(question.stem, question.options)
  3. EmbeddingService.embedText(text) → Result<number[]>
     └─ if err → return err  (no .NET call)
  4. QuestionApiService.saveQuestion(question, topic, difficulty) → Result<{ id: uuid }>
     └─ if err → return err  (no embedding write)
  5. QuestionEmbeddingRepository.insert({ questionId, embedding, modelName })
     └─ if err → return err  ← flag orphaned question for Phase 5 retry
  6. return ok(TQuestion)  ← response shape unchanged
```

---

## File-by-File Plan

### New files

| File | Purpose |
|------|---------|
| `src/db/schemas/question-embedding.schema.ts` | `questionEmbeddings` table + `exsimEngineSchema` (`pgSchema('exsim_engine')`) singleton |
| `src/db/schemas/grounding-embedding.schema.ts` | `groundingEmbeddings` table (imports `exsimEngineSchema`) |
| `src/db/schemas/batch.schema.ts` | `batches` table + `BatchStatusSchema` Zod enum |
| `src/db/schemas/batch-item.schema.ts` | `batchItems` table + `BatchItemStatusSchema` Zod enum |
| `src/common/types/error-result.type.ts` | `TErrorResult` moved here — shared services can't import upward from a feature module |
| `src/shared/constants/embedding.constants.ts` | `EMBEDDING_MODEL_NAME` + `buildEmbeddingText(stem, options)` — Phase 3 imports this too |
| `src/shared/services/embedding.service.ts` | `EmbeddingService.embedText()` → `Result<number[], TErrorResult>` |
| `src/shared/services/embedding.service.spec.ts` | Unit tests |
| `src/shared/modules/embedding.module.ts` | `@Global()` module providing/exporting `EmbeddingService` |
| `src/modules/generator/services/question-api.service.ts` | HTTP client wrapping the .NET `POST /Questions` call → `Result<{ id: string }, TErrorResult>` |
| `src/modules/generator/services/question-api.service.spec.ts` | Unit tests |
| `src/modules/generator/repositories/question-embedding.repository.ts` | `QuestionEmbeddingRepository.insert()` → writes to `question_embeddings` |
| `src/modules/generator/repositories/index.ts` | Barrel export |
| `src/modules/generator/repositories/question-embedding.repository.spec.ts` | Unit tests |
| `test/generator-storage.e2e-spec.ts` | Integration test with real Postgres + pgvector + mocked .NET |

### Modified files

| File | Change |
|------|--------|
| `src/config/app.config.ts` | Add `DOTNET_API_URL: z.string().url()` to env schema |
| `src/db/schemas/index.ts` | Add exports for 4 new schema files |
| `src/modules/generator/types/common.types.ts` | Re-export `TErrorResult` from `@/common/types` (backward compat) |
| `src/modules/generator/services/generator.service.ts` | Inject `EmbeddingService`, `QuestionApiService`, `QuestionEmbeddingRepository`; extend `generateOne` with steps 2–5 |
| `src/modules/generator/services/generator.service.spec.ts` | Add test cases for embed, .NET call, embedding write, and each failure branch |
| `src/modules/generator/generator.module.ts` | Add `HttpModule`, `QuestionApiService`, `QuestionEmbeddingRepository` to providers/imports |
| `src/modules/generator/index.ts` | Add `repositories` barrel export |
| `src/shared/services/index.ts` | Add `EmbeddingService` export |
| `src/shared/modules/index.ts` | Add `EmbeddingModule` export |
| `src/app.module.ts` | Add `EmbeddingModule` to imports (after `DatabaseModule`) |
| `package.json` | Add `@nestjs/axios`, `axios` |

---

## `QuestionApiService` Interface

```typescript
// src/modules/generator/services/question-api.service.ts
saveQuestion(
  question: TQuestion,
  topic: string,
  difficulty: TQuestionDifficulty,
): Promise<Result<{ id: string }, TErrorResult>>
```

Builds payload from `TQuestion` + `topic` + `difficulty`, POSTs to `${DOTNET_API_URL}/Questions`, returns `ok({ id })` on 201, `err` on any non-2xx or network error.

---

## Zod Schema for .NET Request/Response

Define in `src/modules/generator/schemas/`:

```typescript
// question-api.schema.ts
export const CreateQuestionOptionSchema = z.object({
  option: z.string(),
  isCorrect: z.boolean(),
});

export const CreateQuestionTagSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const CreateQuestionPayloadSchema = z.object({
  statement: z.string(),
  solution: z.string(),
  imageUrl: z.string().nullable(),
  options: z.array(CreateQuestionOptionSchema),
  childQuestions: z.array(z.unknown()),
  tags: z.array(CreateQuestionTagSchema),
});

export const SaveQuestionResponseSchema = z.object({
  id: z.string().uuid(),
});
```

---

## Test Plan

### Unit: `embedding.service.spec.ts`
- Returns `ok(number[])` — mock `ai.embed()` resolving
- Returns `err(500)` — mock `ai.embed()` rejecting

### Unit: `question-api.service.spec.ts`
- Maps `TQuestion + topic + difficulty` to correct .NET payload (statement, solution, options, tags)
- Returns `ok({ id })` on HTTP 201
- Returns `err(500)` on network error / non-2xx response

### Unit: `question-embedding.repository.spec.ts`
- `insert()` calls `db.insert(questionEmbeddings).values(...)` with correct shape
- Handles DB error and returns `err`

### Unit: `generator.service.spec.ts` (additions)
- Calls `embeddingService.embedText` with `buildEmbeddingText(stem, options)` output
- Returns `err` and skips .NET call when `embedText` fails
- Returns `err` and skips embedding write when `.NET call` fails
- Returns `err` when embedding write fails (logs orphaned question id)
- Returns `ok(TQuestion)` on full happy path

### Integration: `test/generator-storage.e2e-spec.ts`
- Spin up `pgvector/pgvector:pg16` via Testcontainers (table created via raw SQL in `beforeAll`)
- Mock Azure AI SDK + mock .NET HTTP endpoint (return fixed question ID)
- `POST /generator/one` → assert HTTP 201
- Assert 1 row in `question_embeddings` with `question_id = mocked-id` and `length(embedding) = 1536`
- Simulate DB insert failure → assert error returned (no partial state)

---

## Key Pitfalls

1. **`exsimEngineSchema` singleton** — `pgSchema('exsim_engine')` defined once in `question-embedding.schema.ts`, imported by the other 3 schema files. Redefining it causes Drizzle to treat them as separate schemas.
2. **`vector` column type** — available from `drizzle-orm/pg-core` since v0.43+. We're on v0.45.2, no custom type needed.
3. **Orphaned questions** — if the .NET call succeeds but embedding write fails, the question exists in .NET with no embedding. Log the returned `questionId` prominently; Phase 5 batch retry logic will need to clean this up.
4. **`DOTNET_API_URL` in tests** — integration test must override this with the mock server URL. Use NestJS `overrideProvider` or mock `HttpService` in the test module.
5. **`TErrorResult` import direction** — `EmbeddingService` lives in `shared/` and can't import from a feature module. Move `TErrorResult` to `src/common/types/` first before implementing `EmbeddingService`.
