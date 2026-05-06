---
name: Project Architecture
description: Modules, workers, queue topology, DB schema patterns, and key design decisions for exsim-ai-service
type: project
---

NestJS AI service generating exam questions with Azure OpenAI (GPT-4o + Ada embeddings), Drizzle ORM on Postgres, BullMQ queues backed by Redis, and ts-rest contracts.

**Module list:** generator, question, question-batch, embedding, deduplicator, validator, tagger, grounding, analytics, email, health. Plus shared workers (QuestionBatchWorker, DocumentIngestionWorker) in src/workers/.

**Queue topology:**
- QUESTION_BATCH_ITEM_QUEUE — processes one question per job, concurrency 5
- DOCUMENT_INGESTION_QUEUE — ingests PDFs for grounding, concurrency 2

**BaseService pattern:** Single-table services pass table in super(db, Table). Multi-table orchestrators pass only db. GeneratorService extends BaseService<typeof QuestionEmbeddings> even though it is an orchestrator — intentional to get insertOne for embedding writes.

**Auth:** UserHeaderGuard reads x-user-id header, queries AspNetUsers/AspNetRoles from a shared .NET Identity database. Only ADMINISTRATOR role is currently permitted (all other roles get 401).

**Error handling:** neverthrow Result<T, TErrorResult> throughout services. Workers re-throw errors after recording them so BullMQ retry machinery fires. Guards throw HttpExceptions (correct NestJS pattern).

**Observability:** Langfuse tracing on all LLM calls; Application Insights metrics for token usage, retries, batch completion. Pino structured logging throughout.

**Why:** The service is intentionally single-responsibility for AI work; all business CRUD lives in the external .NET API.
