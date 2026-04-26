# Spec for Phase 2: Storage and Happy Path

branch: claude/feature/storage-and-happy-path

## Summary

Implement the storage layer for generated questions and their embeddings. This phase connects the Generator from Phase 1 to a real PostgreSQL database (with pgvector), persisting each question and its embedding atomically. By the end of this phase, the full happy-path flow — generate, embed, store — runs end-to-end against a real database.

## Functional Requirements

- Finalise the Drizzle ORM schema for the following tables: `questions`, `question_embeddings`, `grounding_embeddings`, `batches`, `batch_items`
- Implement an `EmbeddingService` that calls the Azure OpenAI embeddings API (`text-embedding-3-small`) and returns a `number[]` vector
- Extend `GeneratorService` to orchestrate the full happy path: generate a question → generate its embedding → insert both within a single database transaction
- Expose the happy-path flow through the existing `POST /generator/one` endpoint (updated to persist results)
- Run Drizzle migrations against the local Postgres instance to create all required tables and the pgvector extension

## Possible Edge Cases

- Azure OpenAI embedding API call fails after the question has already been generated — the transaction must roll back so no partial data is written
- The pgvector extension is not enabled on the target Postgres instance, causing the migration to fail
- The embedding vector dimension does not match the column definition (must be 1536 for `text-embedding-3-small`)
- Database connection is unavailable at startup — the service should fail fast with a clear error, not silently degrade
- `question_embeddings` insert succeeds but `questions` insert fails (or vice versa) — atomicity via a single transaction must prevent this

## Acceptance Criteria

- All five tables (`questions`, `question_embeddings`, `grounding_embeddings`, `batches`, `batch_items`) exist in the database after running migrations
- Calling `POST /generator/one` results in one row written to `questions` and one row written to `question_embeddings` in the same transaction
- The embedding stored in `question_embeddings` has exactly 1536 dimensions
- If either the question insert or the embedding insert fails, neither record is persisted (transaction atomicity verified)
- An integration test using Testcontainers confirms both writes land correctly against a real Postgres instance with pgvector enabled
- Manually generating 10 questions via the endpoint produces 10 persisted question rows and 10 corresponding embedding rows

## Open Questions

- Should `grounding_embeddings` and `batches`/`batch_items` tables be populated in this phase, or just created via migration and left empty until later phases?
- What is the target Postgres host for development (Neon, Azure Flexible Server, local Docker)? Local Docker
- Should the `questions` table live in a dedicated schema (e.g. `exsim_engine`) or the default `public` schema? We already have `questions` table in seperate project we are just going to perform crud operations. In this project we already have a `questions` schema in @src/db/questions.schema.ts
- Is there a soft-delete requirement on the `questions` table, or is hard delete acceptable for MVP? We are not going to allow delete in this project.

## Testing Guidelines

Create test files in `./tests` (or alongside the relevant service as `.spec.ts`) covering:

- **Unit test — EmbeddingService:** mock the Azure OpenAI client and verify the service returns a correctly shaped `number[]` and handles API errors gracefully
- **Unit test — GeneratorService (extended):** mock both the AI SDK and EmbeddingService; verify the service calls both in order and invokes a transactional insert
- **Integration test — happy path (Testcontainers):** spin up a real Postgres container with pgvector, run migrations, call the full generate+embed+store flow, and assert both `questions` and `question_embeddings` contain the expected rows
- **Integration test — transaction rollback:** simulate a failure during the embedding insert and assert the `questions` row was also rolled back
