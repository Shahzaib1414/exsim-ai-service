# Plan: Phase 3 (Deduplication) & Phase 4 (Validator + Tagger)

## Context

The service currently completes Phase 2: it generates a question via GPT-4o, embeds it, saves it to the .NET API, and stores the embedding. There is no deduplication, quality validation, or metadata tagging.

This plan implements:
- **Phase 3**: Similarity check against existing question embeddings using pgvector's `<=>` operator; retry up to 3 times if a duplicate is found
- **Phase 4A**: LLM-based quality validation of generated questions
- **Phase 4B**: LLM-based metadata enrichment (Bloom's taxonomy level, grade level)

Pipeline order after this plan (per Project-Detail.md spec):
```
Generate → Embed → Deduplicate → Validate → Tag → Save to .NET → Store embedding
```

---

## New Files

```
src/modules/deduplicator/
  deduplicator.module.ts
  index.ts
  services/
    deduplicator.service.ts
    deduplicator.service.spec.ts

src/modules/validator/
  validator.module.ts
  index.ts
  schemas/
    validation.schema.ts
    index.ts
  services/
    validator.service.ts
    validator.service.spec.ts

src/modules/tagger/
  tagger.module.ts
  index.ts
  schemas/
    tag.schema.ts
    index.ts
  services/
    tagger.service.ts
    tagger.service.spec.ts
```

---

## Modified Files

| File | Change |
|------|--------|
| `src/modules/generator/services/generator.service.ts` | Refactor to retry loop + inject 3 new services |
| `src/modules/generator/generator.module.ts` | Import 3 new modules |
| `src/modules/question/services/question.service.ts` | Add optional `extraTags` param to `saveQuestion` |
| `src/app.module.ts` | Register 3 new Global modules |
| `src/contracts/generator.contract.ts` | Add 422 response to generateOne contract |
| `src/common/types/error-responses.type.ts` | Add `UnprocessableError` type |

---

## Phase 3: DeduplicatorModule

### Schema / Types

```typescript
// src/modules/deduplicator/schemas/deduplicator.schema.ts
export const DuplicateCheckResultSchema = z.object({
  isUnique: z.boolean(),
  similarQuestionIds: z.array(z.string()),
});
export type TDuplicateCheckResult = z.infer<typeof DuplicateCheckResultSchema>;
export const DEDUP_SIMILARITY_THRESHOLD = 0.90;
```

### DeduplicatorService

Extends `BaseService`. Inject `DRIZZLE_CLIENT`. Uses raw `sql` template (Drizzle has no native pgvector operator).

```typescript
async checkUniqueness(
  embedding: number[],
  threshold = DEDUP_SIMILARITY_THRESHOLD,
): Promise<Result<TDuplicateCheckResult, TErrorResult>>
```

pgvector query:
```typescript
const vectorLiteral = `[${embedding.join(',')}]`;
const rows = await this.db.execute(sql`
  SELECT "QuestionId"
  FROM "QuestionEmbeddings"
  WHERE (1 - ("Embedding" <=> ${sql.raw(vectorLiteral)}::vector)) >= ${threshold}
  LIMIT 5
`);
return ok({ isUnique: rows.rows.length === 0, similarQuestionIds: rows.rows.map(r => r.QuestionId as string) });
```

### GeneratorService — Retry Loop

Replace linear 4-step flow with a loop (max 3 attempts). Extract LLM call to private `callLlm()` helper.

```typescript
const MAX_ATTEMPTS = 3;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  // 1. Generate
  // 2. Embed
  // 3. Dedup → if not unique and attempt < 3: continue; else return err(409)
  // 4. Validate → if invalid: return err(422)
  // 5. Tag
  // 6. Save to .NET (with extraTags)
  // 7. Store embedding
  // 8. return ok(question)
}
```

Error codes:
- All 3 dedup attempts fail → **409 CONFLICT**
- Validation fails → **422 UNPROCESSABLE_ENTITY**
- LLM/infra error → **500 INTERNAL_SERVER_ERROR**

---

## Phase 4A: ValidatorModule

### Schema

```typescript
// src/modules/validator/schemas/validation.schema.ts
export const ValidationResultSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(z.string()),
});
export type TValidationResult = z.infer<typeof ValidationResultSchema>;
```

### ValidatorService

1. **Rule-based** (no LLM, fast-fail): distinct options, non-empty stem/explanation
2. **LLM check** via `generateObject(ValidationResultSchema)`: clarity, distractor plausibility, correct answer unambiguity, explanation accuracy

```typescript
async validate(question: TQuestion): Promise<Result<TValidationResult, TErrorResult>>
```

Rule-based failure skips LLM call entirely.

---

## Phase 4B: TaggerModule

### Schema

```typescript
// src/modules/tagger/schemas/tag.schema.ts
export const BloomsTaxonomySchema = z.enum([
  'Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create',
]);
export const TagsResultSchema = z.object({
  bloomsLevel: BloomsTaxonomySchema,
  gradeLevel: z.string(),
});
export type TExtraTag = { name: string; value: string };
```

### TaggerService

```typescript
async tag(
  question: TQuestion,
  subject: string,
  topic: string,
  difficulty: TQuestionDifficulty,
): Promise<Result<{ extraTags: TExtraTag[] }, TErrorResult>>
```

Returns `[{ name: 'bloomsLevel', value: '...' }, { name: 'gradeLevel', value: '...' }]`. GeneratorService merges these with existing tags before calling `QuestionService.saveQuestion`.

---

## QuestionService Change

```typescript
async saveQuestion(
  question: TQuestion,
  topic: string,
  difficulty: TQuestionDifficulty,
  extraTags: TExtraTag[] = [],  // ← new
): Promise<Result<TSaveQuestionResponse, TErrorResult>>
```

---

## Module Registration

All three new modules are `@Global()` and registered in `AppModule` before `GeneratorModule`. `GeneratorModule` also lists them in its `imports` for explicitness.

---

## Testing Strategy

| Test | Approach |
|------|----------|
| `deduplicator.service.spec.ts` | Mock `DRIZZLE_CLIENT.execute`; test unique/not-unique branches |
| `validator.service.spec.ts` | Mock `generateObject`; test rule-based short-circuit + LLM path |
| `tagger.service.spec.ts` | Mock `generateObject`; assert bloomsLevel and gradeLevel in extraTags |
| `generator.service.spec.ts` | Mock all 3 services; test retry loop (2 dups then unique), all-fail (409), validation fail (422) |

### Manual smoke test
```bash
curl -X POST http://localhost:3000/generator/one \
  -H "Content-Type: application/json" \
  -d '{"subject":"Mathematics","topic":"Algebra","difficulty":"Medium"}'
# Expect 201 with question object including tags
```
