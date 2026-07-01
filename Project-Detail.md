# EXSIM Question Engine — Technology Stack Report

**Version 1.1 · April 2026Prepared for the engineering team**

> This document is a conversation starter, not a final architecture. Disagree, push back, suggest better ideas — that’s the point.
> 

---

## How to read this document

This report helps the team pick the right tools for building the EXSIM Question Engine without assuming any prior background in AI engineering. If you’ve built web apps and APIs before, you have enough context.

For each decision you’ll find:

- **What the problem is** — explanation of why we even need to make a choice here.
- **The options** — the realistic candidates, with their tradeoffs.
- **The recommendation** — what we’re choosing and why.
- **What this means for you** — the practical takeaway if you’re writing the code.

No assumed knowledge of LLMs, embeddings, agents, or vector databases. Every term is introduced the first time it appears.

---

## A short glossary before we start

These terms show up throughout the document. If any feel fuzzy, pin them down here first.

| Term | Plain-English meaning |
| --- | --- |
| **LLM** | Large Language Model. The AI that produces text when given a prompt. GPT-4o, Claude, and DeepSeek are all LLMs. Think of it as a very well-read assistant that writes to order. |
| **Embedding** | A numerical fingerprint of a piece of text. Two sentences with similar meaning produce similar fingerprints, even if they use different words. This is what lets the system detect duplicate questions. |
| **Vector database** | A database that stores those fingerprints and can quickly find the closest matches. Regular databases search by keywords; a vector database searches by meaning. |
| **pgvector** | A free extension for PostgreSQL that turns a normal Postgres database into a vector database. No separate system required. |
| **Agent** | An LLM that’s allowed to make decisions and call tools in a loop, rather than just answering one question. For our pipeline we mostly don’t need full agents — we need structured LLM calls in a fixed order. |
| **Pipeline** | A fixed sequence of processing stages. Our question flow is: Generator → Deduplicator → Validator → Tagger → Store. Each stage has one job. |
| **Prompt** | The instruction we send to the LLM. Prompt quality is roughly 80% of the work in any LLM-powered product. |

---

## What we’re building, in one page

The EXSIM Question Engine generates exam questions automatically using AI, checks them for quality and uniqueness, tags them with metadata, and stores them for students to practise on. A human admin supervises at a few key checkpoints but doesn’t write the questions themselves.

The overall architecture is already decided and documented in the two architecture documents. This report is about the technology choices inside the AI Processing Layer — the box in the middle of the system that takes admin input and produces validated questions.

### Important update since v1.0

The team has decided to **replace SQL Server with PostgreSQL entirely**. The existing database has already been migrated. This changes the stack in a good way:

- **One database engine** across the whole system — the existing app data and the new vector data both live in Postgres.
- **pgvector is just an extension** on the same Postgres instance — no second database to provision, no cross-database consistency problems.
- **One connection pool, one backup strategy, one migration tool.** Operationally much simpler.
- The “where does the vector DB live” question from v1.0 is now settled — it lives in the same place as everything else.

### The technology decisions we still need to make

| # | Decision | What we need to pick | Why it matters |
| --- | --- | --- | --- |
| 1 | Runtime for the engine | Where the AI pipeline code actually runs | Affects how we deploy, scale, and handle long-running jobs |
| 2 | AI orchestration library | The library we use to talk to the LLM | Affects code volume and how easy it is to swap models later |
| 3 | Embedding model | Which model turns questions into fingerprints | Affects cost per question and deduplication quality |
| 4 | Supporting libraries | ORM, queue, validation, observability | Affects developer experience and reliability |

---

## Decision 1: Where the engine runs

### What the problem is

The question engine isn’t a normal web API. A normal API handles a request in under a second and forgets about it. Our engine does something very different: an admin kicks off a batch of 200 questions, and the engine then spends minutes (sometimes longer) doing this for each one:

- Call the LLM to generate a question
- Generate an embedding for that question
- Query pgvector for similar existing questions
- If a duplicate is found, regenerate (up to 3 times)
- Run the question through the Validator LLM
- Run it through the Tagger LLM
- Write everything to the database

We need a runtime that’s comfortable running long jobs, holds persistent database connections, and has room for background workers. That rules out some popular options before we even start.

### The options

**Option A: Cloudflare Workers (edge serverless)**
Workers run JavaScript at the network edge, close to users. Brilliant for short, stateless requests.

- *Why it was on the table:* cheap, scales to zero, fits the modern serverless story.
- *Why it doesn’t fit:* Workers have hard execution-time limits (~30 seconds by default, a few minutes on paid plans). Our batches run for many minutes. We’d have to split each batch into dozens of small chunks and chain them with queues and Durable Objects — more moving parts, not fewer. Postgres connections from Workers also require an HTTP proxy, adding latency on every query.

**Option B: Azure Functions (serverless on Azure)**
Azure’s equivalent of Workers.

- *Why it doesn’t fit:* Same execution-time problem (10 minutes on Consumption plan, longer on Premium but then you’re paying for idle capacity). Cold starts hurt when batches kick off after quiet periods. Hangfire, mentioned alongside Functions in the architecture doc, is a .NET library — useless here because this service is Node.

**Option C: Azure Container Apps — recommended**
A managed container platform. You package your app in a Docker container and Azure runs it. Scales to zero when idle; scales up when batches run.

- *Why it fits:* No execution-time limits. Persistent connections. Background workers work naturally. Same cloud as everything else, so networking and identity stay simple. Scale-to-zero keeps cost near zero during development.

**Option D: A plain Azure VM or App Service**
The traditional path — a VM or managed app platform running Node continuously.

- *Why it’s a fallback, not first choice:* Workable, just more operational overhead than Container Apps. You pay for the machine whether it’s busy or not. Fine if the team prefers boring and predictable over elastic scaling.

### Final recommendation

> **Runtime: Node 20 in a container on Azure Container Apps**
> 
> 
> The engine is a Node.js application packaged as a Docker container. Azure Container Apps runs it, scales it based on queue depth, and drops it to zero when there’s no work. No VM to babysit. Same Azure tenant as everything else.
> 

**Fallback:** If the team prefers fixed, predictable infrastructure, use Azure App Service (Linux) with a Node runtime. Functionally equivalent for our needs.

### What this means for you

- You write a normal Node application. It doesn’t need to know it’s running in a container most of the time.
- No “serverless magic” — the app starts up, listens on a port, processes jobs from a queue, writes to the database. Boringly standard.
- Local development uses the same Docker image. What runs on your laptop runs in the cloud.

---

## Decision 2: The application framework and AI library

### What the problem is

Inside the container we need two things: a framework that organises the code (routes, services, background workers, dependency injection) and a library that talks to the LLM. Two separate choices — we’ll make them one at a time.

### Part A: The application framework

**Option A1: Express (or Fastify)**
The classic minimalist choice. Router and middleware; you build everything else yourself.

- *Pros:* Lightweight, huge ecosystem.
- *Cons:* No opinions means every team invents its own structure. For a multi-stage pipeline this gets messy fast.

**Option A2: NestJS — recommended**
A TypeScript framework inspired by Angular. The team already uses Angular, so NestJS will feel instantly familiar: same modules, services, dependency injection, decorators.

- *Pros:* Perfect fit for a pipeline. Each stage (Generator, Deduplicator, Validator, Tagger) becomes its own module with a clean interface. Built-in support for background workers, queues, scheduled jobs, configuration, validation. Excellent testing story — swap the real LLM for a fake one in one line.
- *Cons:* A little more structure to learn upfront if you’ve only used Express. Since the team already works in Angular, this is near-zero learning cost.

**Option A3: tRPC / Next.js API routes**
Modern full-stack TypeScript setups that tightly couple frontend and backend.

- *Why it doesn’t fit:* The admin frontend is React served through the existing .NET Core API. The engine is a separate backend called from .NET. We don’t need frontend/backend coupling here.

### Part B: The AI library

**Option B1: Raw OpenAI SDK**
Call the OpenAI HTTP API directly.

- *Pros:* No extra layer, full control.
- *Cons:* We write glue code for everything — JSON parsing, schema validation, retries, streaming, model swapping. Switching providers later means rewriting a lot.

**Option B2: LangChain.js**
The JavaScript port of LangChain. Massive ecosystem — 1,000+ integrations.

- *Pros:* Feature-rich. Useful if we ever wanted to connect the engine to Slack, Notion, Gmail, etc.
- *Cons:* Heavy abstractions. Our pipeline is straightforward. LangChain adds layers of indirection that make simple things harder to debug. The JS port lags behind Python.

**Option B3: Mastra**
A newer TypeScript-native AI framework, built on the Vercel AI SDK.

- *Pros:* Clean TypeScript ergonomics, built-in workflow and memory.
- *Cons:* Still maturing. No SOC 2 yet, which matters for an education product handling student data. We also don’t need its agent-autonomy features — our pipeline is deterministic.

**Option B4: Vercel AI SDK — recommended**
The most widely-used AI library in JavaScript (~2.8M weekly downloads). Provider-agnostic: the same code works with OpenAI, Anthropic, Azure OpenAI, Google. Change one line to swap models.

- *Pros:* Best developer experience of the lot. Its `generateObject` function is tailor-made for our use case: you describe the shape of a question (stem, options, correct answer, explanation) using a Zod schema, and the library guarantees the LLM returns data matching that shape. No brittle JSON parsing.
- *Cons:* Smaller ecosystem than LangChain. Not a problem for us — our only integrations are Postgres and the .NET API.

### Final recommendation

> **Framework: NestJS · AI library: Vercel AI SDK v6**
> 
> 
> NestJS gives us a clean, testable structure that maps one-to-one onto our pipeline stages. The Vercel AI SDK gives us typed, schema-validated LLM calls with trivial model-swapping. Together they’re the lightest, most maintainable option we reviewed.
> 

**Important architectural note:** NestJS doesn’t replace the .NET Core API. The React admin portal still talks to .NET. .NET then calls the NestJS service to start batches and check status. Existing authentication, logging, and client contracts stay exactly where they are.

### What this means for you

- If you know Angular, NestJS will feel like home within a day.
- Every pipeline stage is a NestJS module — Generator, Deduplicator, Validator, Tagger each live in their own folder with a clear interface.
- LLM calls look like typed function calls, not stringly-typed prompt templates. If the schema says the question has four options, the compiler will remind you if you forget one.
- Switching from GPT-4o to Claude or DeepSeek later is a one-line change in the provider config.

---

## Decision 3: The embedding model

### What the problem is

Every time we generate a question, we turn it into an embedding (a numerical fingerprint) so we can compare it to existing questions in the bank. The model that produces this fingerprint is separate from the model that writes the questions. It has one job: read text, output a vector of numbers.

The architecture document currently specifies `text-embedding-ada-002`. This was a reasonable choice two years ago — it’s now outdated and we should update it.

### The options

| Model | Price per 1M tokens | Dimensions | Quality score (MTEB) |
| --- | --- | --- | --- |
| text-embedding-ada-002 (old) | $0.10 | 1536 | ~61% |
| text-embedding-3-small | $0.02 | 1536 (flexible) | ~62% |
| text-embedding-3-large | $0.13 | 3072 | ~66% |

A few things jump out:

- **ada-002 is strictly worse than 3-small.** Same dimensions, five times the price, slightly lower quality. There’s no scenario where the old model is the right choice for a new project. Migration is trivial — change the model name in the API call.
- **3-large is better but 6× more expensive.** The quality gap (~4 MTEB points) matters at the margins — finding near-duplicates in a very large, very diverse corpus — not in our regime.
- **Cost for the whole MVP is negligible.** Embedding 10,000 questions at ~200 tokens each is 2M tokens total — 4 cents on 3-small. Embeddings are essentially free. Focus cost attention on GPT-4o generation calls, which are 100–1000× more expensive per call.

### Final recommendation

> **Embedding model: `text-embedding-3-small` via Azure OpenAI**
> 
> 
> Same 1536 dimensions as the currently-specified ada-002, so the pgvector schema doesn’t change at all. Five times cheaper. Slightly better accuracy. It’s a free upgrade.
> 

**Action item:** Update the deduplication flow document to replace ada-002 with text-embedding-3-small before development starts. Everything else in that document remains correct.

### What this means for you

- The Deduplicator module calls Azure OpenAI’s embedding endpoint with `model='text-embedding-3-small'` and receives a 1536-number array.
- That array goes straight into the pgvector column. No post-processing.
- The cosine-similarity query described in the deduplication document works identically.

---

## Decision 4: Supporting libraries

Smaller decisions that still need to be written down so the team is aligned.

| Concern | Choice | Why |
| --- | --- | --- |
| Background job queue | **BullMQ** (Redis-backed) | Batch generation runs for minutes and needs retries, persistence, and progress tracking. BullMQ is the Node standard. Redis = Azure Cache for Redis or equivalent. |
| Schema validation | **Zod** | Used by the Vercel AI SDK for structured LLM outputs and by NestJS for request validation. One validation library across the stack. |
| Database ORM | **Drizzle** | Lightweight, TypeScript-first, lets us drop to raw SQL when needed (required for pgvector’s cosine-distance operator). Prisma is the heavier alternative — fine, but more than we need. |
| Database migrations | **Drizzle Kit** | Comes with Drizzle. Same migration tool as the existing app DB since we’re all on Postgres now. |
| LLM observability | **Langfuse** (self-hosted or cloud free tier) | When something goes wrong with an LLM call, you need the exact prompt, response, tokens, latency, and cost. Langfuse is purpose-built for this and free to start. |
| HTTP logging / APM | **Pino** + Azure Application Insights | Standard Node logging piped to the existing Azure observability stack. |
| Testing | **Vitest** + **Testcontainers** | Fast TS-native test runner; Testcontainers spins up real Postgres and Redis for integration tests. No mocking the database. |
| Secrets management | **Azure Key Vault** | Connection strings, Azure OpenAI keys, and similar never live in `.env` files in production. |

---

## The full stack at a glance

| Layer | Technology | Status |
| --- | --- | --- |
| Admin portal (UI) | React | Existing |
| Student portal (UI) | React / React Native | Existing |
| Front-door API | .NET Core | Existing |
| Primary database | **PostgreSQL** | Existing (migrated from SQL Server) |
| Vector database | **PostgreSQL + pgvector extension** | Same DB instance as primary |
| Question engine (runtime) | Node 20 in a container | New |
| Question engine (framework) | NestJS | New |
| Question engine (AI library) | Vercel AI SDK v6 | New |
| Schema validation | Zod | New |
| Database ORM | Drizzle + Drizzle Kit | New |
| Background jobs | BullMQ + Redis | New |
| LLM (generation, validation, tagging) | GPT-4o via Azure OpenAI | New |
| Embedding model | `text-embedding-3-small` via Azure OpenAI | New (replaces ada-002) |
| LLM observability | Langfuse | New |
| APM / logs | Pino + Application Insights | New |
| Hosting (engine) | Azure Container Apps | New |
| Secrets | Azure Key Vault | New |

---

## How to build this, phase by phase

Build thin vertical slices, not horizontally. Don’t do “all the database first, then all the Generator, then all the Validator” — that path ends with six weeks of work and nothing running end-to-end. Each phase should produce something you can demonstrate.

### Phase 0 — Project setup (Week 0–1)

Before any pipeline code gets written, get the boring stuff right. Skipping this phase is the single most common reason projects slow to a crawl in month two.

**Repository and structure**
- Create a new Git repository (monorepo with pnpm workspaces, or a standalone repo — team’s call). Initial structure:
`exsim-engine/   ├── src/   │   ├── modules/   │   │   ├── generator/   │   │   ├── deduplicator/   │   │   ├── validator/   │   │   ├── tagger/   │   │   └── batch/   │   ├── shared/         # Zod schemas, types, constants   │   ├── db/             # Drizzle schema + migrations   │   └── main.ts   ├── test/   ├── docker/   ├── .env.example   ├── drizzle.config.ts   ├── Dockerfile   └── package.json`
- Every pipeline stage lives in its own module folder with three files: `*.module.ts`, `*.service.ts`, `*.service.spec.ts`. No exceptions.

**Tooling baseline**
- **Node 20 LTS.** Lock the version with `.nvmrc` and `"engines"` in `package.json`.
- **pnpm** as the package manager. Faster than npm, stricter than yarn.
- **TypeScript strict mode.** `"strict": true` in `tsconfig.json`. Non-negotiable.
- **ESLint + Prettier.** Use the NestJS defaults; don’t bikeshed the config.
- **Husky + lint-staged** for pre-commit hooks. Lint and typecheck on every commit.
- **Commitlint** with conventional commits. Makes release notes and changelogs trivial later.

**Environment and configuration**
- Use NestJS `ConfigModule` with Zod validation of `process.env`. If a required env var is missing, the app refuses to start with a clear error. No “undefined is not an object” at 2am.
- `.env.example` checked in, actual `.env` never. The example lists every variable with a one-line description.
- Required env vars for Phase 0: `DATABASE_URL`, `REDIS_URL`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT_GPT4O`, `AZURE_OPENAI_DEPLOYMENT_EMBEDDING`, `NODE_ENV`, `LOG_LEVEL`.

**Database setup**
- Enable the pgvector extension on the existing Postgres instance: `CREATE EXTENSION IF NOT EXISTS vector;`. One-time operation. The DBA runs it, or it becomes the first Drizzle migration.
- Set up Drizzle Kit pointing at the Postgres instance. Write the initial schema for `question_embeddings` and `grounding_embeddings` — just the tables, no data yet.
- Confirm the IVFFlat index can be created: `CREATE INDEX ON question_embeddings USING ivfflat (embedding vector_cosine_ops);`. If this fails, pgvector isn’t properly installed and everything downstream breaks.
- **Decision to confirm:** are we creating a separate database, a separate schema within the existing database, or sharing the same schema? Recommendation: **separate schema** (`exsim_engine.question_embeddings`) within the existing database — isolation without the overhead of a second DB.

**Local development environment**
- `docker-compose.yml` at repo root that spins up:
- Postgres with pgvector preinstalled (use `pgvector/pgvector:pg16` image)
- Redis (for BullMQ)
- Optionally Langfuse for LLM tracing
- One command — `pnpm dev` — should start the app with hot reload against these local services. If getting a new developer productive takes more than 15 minutes, something is wrong.

**CI/CD baseline**
- GitHub Actions (or Azure DevOps, whichever the team already uses) that runs on every PR:
- Lint
- Typecheck
- Unit tests
- Integration tests against a Postgres container
- Build the Docker image
- Deploy pipeline can wait until Phase 4, but the build pipeline should exist on day one.

**Observability from the start**
- Wire Pino logging with a request ID in every log line.
- Wire Application Insights with the Node SDK.
- Create the Langfuse project (cloud free tier is fine for MVP). Keep the API keys in Key Vault.

**Exit criteria for Phase 0**
- A developer can clone the repo, run `pnpm install && docker-compose up && pnpm dev`, and hit a `/health` endpoint that returns 200 with a version string.
- Drizzle can push migrations to the local Postgres.
- The CI pipeline is green on an empty main branch.

*Don’t skip this phase. The week you spend on setup pays back tenfold by Phase 3.*

### Phase 1 — Skeleton and first LLM call (Week 1–2)

Stand up the NestJS service with one endpoint: “generate one Maths question”. It calls GPT-4o through the Vercel AI SDK, gets back a typed question object, returns it. No database yet. No queue. No deduplication. Goal: prove the LLM round-trip works and schema validation catches malformed output.

**Specifically:**
- Define the `Question` Zod schema in `src/shared/schemas/question.ts`.
- Create `GeneratorModule` and `GeneratorService`. The service has one method: `generateOne(params)`.
- Wire `generateObject` from the Vercel AI SDK, passing the Zod schema. If the LLM returns something that doesn’t match, the call throws — handle it with a simple try/catch for now.
- Expose a `POST /generator/one` endpoint for manual testing.
- Write a unit test that mocks the AI SDK and verifies the service returns a valid question.

### Phase 2 — Storage and the happy path (Week 3)

Write the generated question to Postgres, generate and store its embedding.

**Specifically:**
- Finalise the Drizzle schema: `questions`, `question_embeddings`, `grounding_embeddings`, `batches`, `batch_items`.
- Add `EmbeddingService` (calls Azure OpenAI embeddings API, returns `number[]`).
- Extend `GeneratorService` to: generate question → embed question → insert both in a transaction.
- Write an integration test using Testcontainers that confirms both writes land correctly.
- Manually generate 10 questions and eyeball them. This is the first time you’ll know if your prompt is any good.

### Phase 3 — Deduplication loop (Week 4)

Implement the similarity check with the 0.90 threshold and the 3-attempt regeneration loop from the deduplication flow document. This is the highest-risk piece of the system — get it right in isolation.

**Specifically:**
- `DeduplicatorService.checkUniqueness(embedding)` returns `{ isUnique: boolean, similarQuestions: [] }`.
- The Drizzle query uses raw SQL for the `<=>` cosine operator since the ORM doesn’t know about pgvector.
- Seed the database with known near-duplicates. Write tests that confirm the Deduplicator catches them.
- Wire the retry loop: up to 3 attempts, track attempt count, flag for human review after 3 failures.
- Confirm the exit criterion: generate 50 questions in a row and inspect which were flagged as duplicates.

### Phase 4 — Validator and Tagger (Week 5)

Add the LLM-based quality check (Validator) and the metadata enrichment (Tagger). Both follow the same pattern as the Generator — structured LLM calls with a Zod schema — so they go quickly once the pattern is established.

**Specifically:**
- `ValidatorService.validate(question)` returns `{ isValid, issues[] }`. Combine rule-based checks (exactly 4 options, options not identical, answer is one of the options) with an LLM-based quality check (clarity, distractor plausibility, grammar).
- `TaggerService.tag(question)` returns `{ subject, topic, difficulty, bloomsLevel, gradeLevel }` via an LLM call with a strict Zod schema.
- Wire them into the pipeline in order: Generator → Deduplicator → Validator → Tagger → Store.

### Phase 5 — Batch mode and queue (Week 6)

Bring in BullMQ. The .NET Core API gets a new endpoint that posts a batch request to NestJS, which enqueues N jobs. Each job runs the full pipeline for one question.

**Specifically:**
- `BatchModule` with a `POST /batches` endpoint (takes params: count, subject, topic, difficulty, etc.).
- Enqueue N jobs in BullMQ, one per question.
- `BatchProcessor` (BullMQ worker) runs the pipeline for each job and updates batch progress.
- `GET /batches/:id` returns current progress for UI polling.
- Add idempotency: if the same batch request arrives twice (client retry), don’t double-generate.
- Goal: end-to-end batch of 50 questions running without manual intervention.

### Phase 6 — Admin UI integration (Week 7)

Wire the React admin portal. This is where the human checkpoints from the architecture document become real.

**Specifically:**
- Batch creation form (subject, topic, difficulty, count).
- Sample review screen: 3–5 questions shown before the full batch runs, admin approves or rejects the pattern.
- Batch progress view with live polling.
- Failed-question review queue for questions that hit the 3-attempt limit.
- All routed through the existing .NET API, which proxies to NestJS.

### Phase 7 — Grounding content ingestion (Week 8)

PDF upload flow — parse, chunk, embed, store in `grounding_embeddings`. Wire the Generator prompt to include relevant grounding chunks based on subject/topic.

This phase can run in parallel with earlier phases if the client has rulebooks ready.

**Specifically:**
- `GroundingModule` with a PDF upload endpoint (admin-only).
- Chunk with a simple recursive splitter (LangChain’s text splitter is usable standalone, or write ~50 lines).
- Embed each chunk, store with metadata (source doc, page, subject, exam type).
- Update `GeneratorService` to retrieve top-K relevant chunks before generation and inject them into the prompt.

### Phase 8 — AI Angel analytics (Week 9–10)

Separate module. Takes a completed test session, pulls the student’s history and cohort benchmarks, calls an LLM to generate insights in the four categories (progress, strengths, weaknesses, cohort comparison).

This is the one part of the system that’s genuinely agent-shaped — the LLM reasons over data rather than filling a template. If it grows in scope (tool use, multi-step reasoning), this is where **Mastra** or **LangGraph.js** would start to earn their keep. Keep the interface clean so we can swap implementations later.

### Phase 9 — Hardening (ongoing)

- Retry policies everywhere (exponential backoff on Azure OpenAI 429s).
- Idempotency keys on batch jobs.
- Cost tracking per batch, surfaced in the admin UI.
- Langfuse traces wired up across the whole pipeline.
- Rate limiting against Azure OpenAI quotas.
- Alerting on failure rates.
- Load tests with a synthetic batch of 1,000 questions.

---

## Things that can go wrong (and what to do about them)

Not exhaustive — just the failure modes the team should be aware of before writing code.

| Risk | What it looks like | Mitigation |
| --- | --- | --- |
| **High duplicate rate as the bank grows** | After 1,000+ questions per topic, 30%+ of generations get flagged as duplicates and waste LLM spend. | The architecture doc already anticipates this. Switch to the hybrid approach (inject existing questions into the prompt as negative examples) when the rate crosses 20%. |
| **Azure OpenAI rate limits** | Batches fail mid-way because we exceed the tokens-per-minute quota. | Request a quota increase early. Queue-level throttling in BullMQ. Exponential backoff on 429s. |
| **Cost overruns on GPT-4o** | A test batch runs away and burns hundreds of dollars overnight. | Cost caps per batch in the Generator. Daily spend alerts in Azure. Langfuse traces every call with token counts. |
| **Bad questions slip past automated validation** | The Validator LLM approves a question that a human would catch instantly (ambiguous wording, incorrect answer key). | Keep the human batch-approval checkpoint in for the entire MVP. Don’t make it optional based on “trust”. Revisit only after 6 months of clean production data. |
| **Embedding drift** | We upgrade to a newer embedding model in 18 months and all existing embeddings become incompatible. | Store the model name alongside every embedding. When upgrading, re-embed in the background and swap over atomically. Never mix models in one similarity search. |
| **pgvector index tuning** | After 50k+ questions, similarity queries slow dramatically because the IVFFlat index has the wrong `lists` parameter. | Build monitoring into Phase 9. Re-tune the index when p95 query latency crosses a threshold. Consider switching to HNSW at 100k+ vectors. |
| **Postgres under load** | The same DB now serves the app, the engine, and vector queries. Contention during batch runs slows user-facing traffic. | Use a read replica for vector queries if contention becomes real. Keep batch work off peak hours initially. Monitor connection pool exhaustion early. |

---

## Questions the team will probably ask

**Why Node and not .NET for the engine?**
Two reasons. First, the AI ecosystem in JavaScript (Vercel AI SDK, LangChain.js, Mastra) is more mature and moves faster than the .NET equivalent. Second, the engine is a separate service — keeping it in a different runtime gives us a clean boundary and prevents it from accidentally becoming part of the monolith. The .NET API stays the stable front door; the Node engine is a specialised backend with a narrow contract.

**Why not use an agent framework for the whole pipeline?**
Agents shine when the LLM decides what to do next — “should I search the web, call a calculator, or answer directly?”. Our pipeline doesn’t have that property. We know exactly what happens to each question: generate, deduplicate, validate, tag, store, in that fixed order. Treating this as an agent problem would be overkill and harder to debug. We reserve the agent pattern for the AI Angel, where it may genuinely help.

**Now that everything is on Postgres, do we still need two “logical” databases?**
No, and we aren’t creating two. Vector data lives in the same Postgres instance as everything else, just in its own schema (e.g., `exsim_engine`). One connection, one backup, one migration tool.

**Could pgvector slow down the existing app’s queries?**
Short answer: yes if we’re not careful, no if we are. Vector queries scan indexes that are unrelated to the app’s existing tables, so direct contention is low. What can happen is CPU or I/O saturation during large batch runs. Mitigations: run batches during off-peak hours initially, monitor DB load during Phase 5 load tests, move to a read replica for vector queries if needed.

**Why Langfuse instead of Application Insights or Datadog?**
Application Insights and Datadog are general-purpose observability. Langfuse is LLM-specific: it structures every call as a trace with prompt, completion, token counts, latency, and cost, grouped into sessions. When a batch produces a bad question, you find the exact prompt and response in one click. Run general APM alongside it; the two don’t conflict.

**What happens when we want a second subject, like Science?**
The architecture is designed for this. Prompt templates are parameterised in the database, validation rules are in config, and tag schemas are extensible. Adding Science is mostly a content task (write new prompts, upload new rulebooks), not a code task.

**How do we evaluate whether the questions are actually any good?**
Short-term: human review on every batch during MVP. Medium-term: build an evaluation suite with known good/bad questions and run it automatically on every prompt change. Langfuse has evaluation features that help. This deserves its own planning session before Phase 5.

**Do we need Redis just for BullMQ?**
Yes, and it’s worth it. BullMQ needs Redis. We could avoid it with an alternative like pg-boss (BullMQ-like API but uses Postgres instead of Redis), which would save one moving part. Recommendation: start with BullMQ for now — it’s the Node-ecosystem standard and the feature gap matters once we scale. Revisit pg-boss at the Phase 9 hardening stage if the team wants to simplify infra.

---

## Open questions that need a decision before Phase 0 closes

Things I don’t have enough information to settle in this document:

1. **Which Postgres host?** Neon, Azure Flexible Server, DigitalOcean, self-hosted — the team has made this call but I don’t know the answer. This affects connection string format, pooling strategy, and whether pgvector needs explicit enablement by a platform admin.
2. **Schema boundary.** Separate database vs separate schema vs shared schema? Recommendation above is separate schema, but the DBA should bless it.
3. **Monorepo or standalone repo?** Either works. If the team already has a monorepo, plug the engine in. If not, a standalone repo is simpler.
4. **CI provider.** GitHub Actions vs Azure DevOps — which one does the team already use?
5. **Region and data residency.** Are there client requirements about where embeddings and student data can be stored?

---