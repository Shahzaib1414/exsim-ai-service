# Spec for phase-1-skeleton-first-llm-call

branch: claude/feature/phase-1-skeleton-first-llm-call

## Summary
Stand up the NestJS service with a single endpoint that generates one exam question using GPT-4o via the Vercel AI SDK. The response is typed and validated against a Zod schema. No database, no queue, and no deduplication in this phase — the goal is purely to prove the LLM round-trip works and that schema validation catches malformed output.

## Functional Requirements
- Define a `Question` Zod schema in `src/schemas/question.schema.ts` that captures: stem, options (array of 4), correct answer index, and explanation.
- Create a `GeneratorModule` and `GeneratorService` under `src/modules/generator/`.
- `GeneratorService` exposes a single method `generateOne(params)` that calls `generateObject` from the Vercel AI SDK with the `Question` schema.
- If the LLM returns a response that does not match the schema, the call must throw and be caught with a try/catch — no silent failures.
- Expose a `POST /generator/one` HTTP endpoint in `GeneratorController` for manual testing. It accepts a subject, topic, and difficulty in the request body.
- The endpoint returns the validated question object or a structured error response.
- Wire the Vercel AI SDK provider configuration through `ConfigModule` — the Azure OpenAI deployment name and endpoint must come from environment variables, never hardcoded.

## Possible Edge Cases
- The LLM returns a response that is valid JSON but does not conform to the `Question` schema (e.g. fewer than 4 options, missing explanation).
- The LLM call times out or Azure OpenAI returns a 429 rate-limit error.
- The `correct answer` index returned by the LLM is out of bounds relative to the options array.
- The endpoint is called with missing or invalid request body fields (e.g. no subject).
- Azure OpenAI credentials are missing or misconfigured at startup.

## Acceptance Criteria
- `POST /generator/one` with a valid body returns a 200 response with a question object that satisfies the `Question` Zod schema.
- `POST /generator/one` with an invalid body (e.g. missing `subject`) returns a 400 error.
- If the Vercel AI SDK throws due to schema mismatch, the endpoint returns a 500 with a clear error message — it does not crash the process.
- The `GeneratorService` unit test (with mocked AI SDK) passes and confirms the returned object matches the `Question` schema.
- The application starts without errors when all required env vars (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT_GPT4O`) are present.
- The application refuses to start with a clear error message when any required env var is missing.

## Open Questions
- Should the `Question` schema include an `examType` or `subject` field on the stored object itself, or is subject/topic only an input parameter to the generator? Just an input parameter to the generator
- What is the expected difficulty scale — numeric (1–5), string enum (easy/medium/hard), or something defined by the product team? watch @question.schema.ts 
- Is there a maximum token budget per generation call to enforce as a cost guard, even in Phase 1? Not Now But add a comment
- Should `POST /generator/one` be authenticated (e.g. require a service-to-service token from .NET) or is it left open for Phase 1 testing purposes? left open

## Testing Guidelines
Create a test file at `src/modules/generator/services/generator.service.spec.ts` and write meaningful tests for the following cases, without going too heavy:
- Happy path: mock `generateObject` to return a valid question; assert the service returns it unchanged.
- Schema violation: mock `generateObject` to throw a schema validation error; assert the service propagates the error.
- Missing env vars: confirm the config validation rejects startup when `AZURE_OPENAI_ENDPOINT` is absent.
- Controller unit test: mock `GeneratorService.generateOne` to return a valid question; assert the controller returns HTTP 200 with the question body.
- Controller error handling: mock `GeneratorService.generateOne` to throw; assert the controller returns HTTP 500.
