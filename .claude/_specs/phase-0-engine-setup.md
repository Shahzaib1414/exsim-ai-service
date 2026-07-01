# Phase 0: Engine Project Setup

**Status:** In Progress  
**Estimated Duration:** Week 0–1  
**Priority:** Critical — blocks all downstream phases

## Overview

Complete the foundational infrastructure, tooling, and configuration for the EXSIM Question Engine. The repository is already initialized with NestJS and core tooling; this phase finalizes configuration, environment setup, observability, and local development environment.

By the end of Phase 0, a developer should be able to clone the repo, run three commands, and hit a health endpoint that proves the system is configured correctly.

## What's Already Done

✅ NestJS 11.0.1 initialized  
✅ Yarn configured as package manager  
✅ TypeScript configured with ES2023 target  
✅ ESLint with ESLint 9.x configured  
✅ Prettier configured  
✅ Husky 9.x with pre-commit hooks (lint, format, test)  
✅ Jest 30.x configured  
✅ Core dependencies installed

## Goals (Remaining)

- Environment configuration with Zod validation
- Database connection pool configured (no migrations — schema managed elsewhere)
- Local development environment fully functional (Docker Compose)
- CI/CD pipeline configured and passing
- Observability wired from day one (logging, APM, LLM tracing)
- Health check endpoint working

## Success Criteria

- [ ] Developer can clone repo, run `yarn install && docker-compose up && yarn dev`, and hit `GET /health` returning 200 with version string
- [ ] CI pipeline is green on main branch
- [ ] All required environment variables documented in `.env.example`
- [ ] Docker Compose defines Postgres, Redis, and optional Langfuse
- [ ] Pino logging configured with request ID in every log
- [ ] Application Insights SDK wired
- [ ] Langfuse project created (cloud free tier acceptable)
- [ ] Database connection pool configured and tested
- [ ] ENV validation with Zod prevents app start on missing vars
- [ ] First commit can be merged and deployed

## Scope

### In Scope: Project Setup

**Repository and Structure**
- ✅ NestJS project initialized
- Ensure strict folder structure is in place (detailed below)
- ✅ `.gitignore`, `.prettierrc`, ESLint config in place
- Create barrel exports (`index.ts` files) in each module directory as modules are added
- Verify `.yarnrc.yml` has yarn as the configured package manager

**Tooling Baseline**
- ✅ Node version locked at 20 LTS with `.nvmrc`
- ✅ `"engines": { "node": "20.x" }` in `package.json`
- ✅ Yarn configured as package manager
- ✅ TypeScript configured with ES2023 target
- ✅ ESLint with `@typescript-eslint` configured
- ✅ Prettier with opinionated config configured
- ✅ Husky hooks for pre-commit (lint, format, test)
- Confirm commitlint is configured with conventional commits
- Consider adding commit message generation tooling (e.g., Commitizen)

**Environment and Configuration**
- NestJS `ConfigModule` with Zod validation of `process.env`
- Application refusal to start if required env vars missing
- `.env.example` checked in with every variable documented
- Required environment variables:
  - `DATABASE_URL` — Postgres connection string
  - `REDIS_URL` — Redis connection string
  - `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint
  - `AZURE_OPENAI_KEY` — Azure OpenAI API key
  - `AZURE_OPENAI_DEPLOYMENT_GPT4O` — GPT-4o model deployment name
  - `AZURE_OPENAI_DEPLOYMENT_EMBEDDING` — text-embedding-3-small deployment name
  - `NODE_ENV` — development | test | production
  - `LOG_LEVEL` — debug | info | warn | error
  - `LANGFUSE_PUBLIC_KEY` — Langfuse project public key
  - `LANGFUSE_SECRET_KEY` — Langfuse project secret key
  - `LANGFUSE_BASEURL` — Langfuse endpoint (cloud or self-hosted)

**Database Configuration**
- Configure database connection pooling (connection string from Postgres instance)
- Set up Drizzle ORM to connect to existing schema (schema managed by other project)
- Configure READ/WRITE operations on existing tables
- **No migrations in this project** — schema is managed elsewhere
- Test database connectivity from local Docker environment

**Local Development Environment**
- `docker-compose.yml` at repo root with services:
  - Postgres 16 (matching production schema)
  - Redis (for BullMQ)
  - Langfuse (optional, nice-to-have for tracing)
- Single entry point: `yarn dev` starts app with hot reload against these services
- Onboarding time for new developer: ≤ 15 minutes from repo clone to running app

**CI/CD Baseline**
- GitHub Actions or Azure DevOps pipeline (team's existing provider)
- Runs on every PR:
  - Lint with ESLint and Prettier check (`yarn lint`, `yarn format`)
  - TypeScript type-check
  - Unit tests (Jest with `yarn test`)
  - Integration tests against Postgres container
  - Docker image build (no push yet)
- ✅ Pre-commit hooks already enforce lint/format/test on commits

**Observability**
- Pino logger with request ID middleware
- Request ID propagated through all logs
- Application Insights Node SDK configured (connect to existing Azure subscription)
- Langfuse project created (free cloud tier or self-hosted)
- API keys stored in Azure Key Vault (not in `.env`)
- Example endpoint: `GET /health` returns `{ status: 'ok', version, environment }`

### Out of Scope: Pipeline Code & Migrations

- No Generator, Deduplicator, Validator, or Tagger service implementations
- No batch processing queue
- No LLM API calls
- **No database schema setup or migrations** — schema is managed by other project, this project only performs CRUD
- No unit tests beyond tooling verification

## Technical Decisions to Confirm

Before starting, confirm these decisions with the team:

1. **CI provider:** GitHub Actions or Azure DevOps?
2. **Secrets management:** Azure Key Vault access from CI pipeline — preconfigured?
3. **Postgres connection string:** Where is the existing Postgres instance? (Connection string needed for `.env`)
4. **Schema name:** Which schema contains the existing tables we'll CRUD against?

## Architecture: Folder Structure

```
exsim-engine/
├── src/
│   ├── main.ts                      # App entry point
│   ├── app.module.ts                # Root module
│   │
│   ├── config/
│   │   ├── app.config.ts            # AppConfigService
│   │   ├── database.config.ts       # DatabaseConfigService
│   │   └── index.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── constants/
│   │
│   ├── modules/
│   │   ├── generator/
│   │   │   ├── generator.module.ts
│   │   │   ├── generator.service.ts
│   │   │   ├── generator.service.spec.ts
│   │   │   └── index.ts
│   │   ├── deduplicator/            # Similar structure
│   │   ├── validator/               # Similar structure
│   │   ├── tagger/                  # Similar structure
│   │   └── batch/                   # Similar structure
│   │
│   ├── shared/
│   │   ├── schemas/                 # Zod schemas
│   │   │   ├── question.schema.ts
│   │   │   └── index.ts
│   │   ├── types/
│   │   └── constants/
│   │
│   ├── db/
│   │   ├── schema.ts                 # Drizzle schema (READ-ONLY representation of existing DB)
│   │   ├── client.ts                 # Database connection pool
│   │   └── index.ts
│   │
│   ├── utils/
│   └── types/
│
├── test/
│   ├── app.e2e-spec.ts
│   ├── jest-e2e.json
│   └── fixtures/
│
├── docker/
│   └── Dockerfile
│
├── .env.example
├── .nvmrc
├── .prettierrc
├── .eslintrc.js
├── .husky/
├── commitlint.config.js
├── docker-compose.yml
├── drizzle.config.ts
├── Dockerfile
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```

## Dependencies (Core Only)

**Runtime:**
- `@nestjs/core` ^11.0.0
- `@nestjs/common` ^11.0.0
- `@nestjs/config` ^3.x (for ConfigModule with Zod)
- `zod` ^3.x
- `pino` ^9.x
- `pino-http` ^9.x
- `reflect-metadata` ^0.2.x
- `rxjs` ^7.x

**Development:**
- ✅ `@nestjs/cli` ^11.0.0
- ✅ `@nestjs/schematics` ^11.0.0
- ✅ `@nestjs/testing` ^11.0.0
- ✅ `typescript` ^5.7.x
- ✅ `ts-jest` ^29.x
- ✅ `jest` ^30.x
- ✅ `@typescript-eslint/eslint-plugin` ^8.x
- ✅ `@typescript-eslint/parser` ^8.x
- ✅ `eslint` ^9.x
- ✅ `prettier` ^3.x
- ✅ `husky` ^9.x
- `lint-staged` ^15.x (for pre-commit hooks)
- `commitlint` ^19.x (for conventional commits)
- `drizzle-orm` ^0.30.x (for CRUD operations)
- `pg` ^8.x (for Postgres driver)

**Optional (Phase 0 setup only for observability):**
- `@azure/monitor-opentelemetry` (for Application Insights)
- `langfuse` ^2.x (SDK for tracing)

## Acceptance Criteria Checklist

- [ ] `git clone <repo> && cd exsim-engine && yarn install` succeeds
- [ ] `docker-compose up -d` brings up Postgres, Redis, and optionally Langfuse
- [ ] `yarn dev` starts dev server with hot reload against local services
- [ ] `curl http://localhost:3000/health` returns `{ status: 'ok', version, environment }`
- [ ] `yarn test` runs and passes
- [ ] `yarn lint` runs and passes (no violations)
- [ ] `yarn format` formats all code correctly
- [ ] `yarn build` compiles TypeScript to `dist/` with no errors
- [ ] `.env.example` lists every required variable with description
- [ ] `DATABASE_URL` from `.env` connects to Postgres successfully
- [ ] Drizzle schema file reflects existing tables from other project
- [ ] CI pipeline is green on first commit to main
- [ ] Pre-commit hooks enforce lint, format, and test on every commit
- [ ] New developer can be productive within 15 minutes of `git clone`

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Node version conflicts | ✅ `.nvmrc` + `engine` field in `package.json` already set. CI fails if version mismatches. |
| Database connection failures | Test `DATABASE_URL` from `.env` during Phase 0. Ensure connection pooling is configured. |
| Type-checking overhead in CI | Ensure TypeScript cache is preserved between runs. Use `ts-jest` with incremental mode. |
| Long Docker image build times | Use multi-stage Dockerfile, layer caching. Phase 0 doesn't need to optimize; Phase 8 hardening does. |
| Team unfamiliar with NestJS | Phase 0 is scaffolding only. Actual NestJS code comes in Phase 1. Provide NestJS documentation links in README. |
| Drizzle schema drift | Drizzle schema file is read-only representation of existing DB. Keep in sync with other project's migrations. |

## Dependencies on Other Work

- **Prerequisite:** Postgres instance with existing schema (managed by other project)
- **Prerequisite:** Postgres connection string available for `.env` configuration
- **Prerequisite:** Azure OpenAI instance provisioned (endpoints, keys for Phase 1+)
- **Prerequisite:** CI/CD platform decision (GitHub Actions vs Azure DevOps)
- **Prerequisite:** Azure Key Vault configured with secret access from CI

## Open Questions for Team

1. CI platform: GitHub Actions or Azure DevOps? Github Actions
2. Postgres connection string for `.env`? `"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=ExsimDb;Username=postgres;Password=postgres_password;"}`
3. Which schema contains the tables we'll CRUD against? 
```cs 
public class Question : BaseAuditableEntity<Guid>
{
    private readonly List<QuestionTag> _tags = new();
    private readonly List<QuestionOption> _options = new();
    private readonly List<StudentExam> _studentExams = new();
    private readonly List<Question> _childQuestions = new();

    public QuestionStatement Statement { get; private set; }
    public string Solution { get; private set; }
    public string ImageUrl { get; private set; }
    public Guid TopicId { get; set; }
    public virtual Topic Topic { get; set; }
    public Guid? ParentQuestionId { get; set; }  // Nullable to allow top-level questions
    public virtual Question ParentQuestion { get; set; }

    public  IReadOnlyCollection<QuestionTag> Tags => _tags.AsReadOnly();
    public  IReadOnlyCollection<QuestionOption> Options => _options.AsReadOnly();
    public virtual IReadOnlyCollection<StudentExam> StudentExams => _studentExams.AsReadOnly();
    public  IReadOnlyCollection<Question> ChildQuestions => _childQuestions.AsReadOnly();

    [Column(TypeName = "varchar(20)")]
    public QuestionStatus Status { get; set; }

    private Question() { }
    
    internal Question(Guid id, QuestionStatement statement, string solution,Guid topicId ,string imageUrl, Guid? parentQuestionId)
    {
        Id = id;
        Statement = statement;
        Solution = solution;
        ImageUrl = imageUrl;
        ParentQuestionId = parentQuestionId;
        TopicId = topicId;
        Status = QuestionStatus.Draft;
    }

    public void AddTopic(Topic topic)
    {
        if (topic == null)
        {
            throw new ExsimException("topic cannot be null");
        }
        TopicId = topic.Id;
    }

    public void AddOption(QuestionOption opt)
    {

        var type = GetQuestionType();
        if (!type.RequiresOptions())
            throw new ExsimException($"Question type {(string)type} does not allow options.");

        if (type.Value == QuestionType.Closed.Value && _options.Count >= 2)
            throw new ExsimException("Closed questions can only have 2 options.");

        if (_options.Any(o => (string)o.Option == (string)opt.Option))
            throw new ExsimException($"Option with name '{((string)opt.Option)}' already exists");

        opt.QuestionId = this.Id;
        _options.Add(opt);
    }

    public void AddTag(QuestionTag tag)
    {
        if (_tags.Any(t => (string)t.Name == (string)tag.Name))
            throw new ExsimException($"Tag with name '{(string)tag.Name}' already exists");
        tag.QuestionId = this.Id;
        _tags.Add(tag);
    }

    public QuestionType GetQuestionType()
    {
        var typeTag = _tags.FirstOrDefault(t => (string)t.Name == QuestionTagTypes.type);
        if (typeTag == null)
            throw new ExsimException("Question type is not set");

        return (QuestionType)((string)typeTag.Value);
    }

    public QuestionDifficulty GetQuestionDifficulty()
    {
        var difficultyTag = _tags.FirstOrDefault(t => (string)t.Name == QuestionTagTypes.difficulty);
        if (difficultyTag == null)
            throw new ExsimException("Question difficulty is not set");

        return (QuestionDifficulty)(string)difficultyTag.Value;
    }
   
    public void AddChild(Question question)
    {
        _childQuestions.Add(question);
    }

    public void ClearOptions()
    {
        _options.Clear();
    }
    public void ClearTags()
    {
        _tags.Clear();
    }
    public void ClearChilds()
    {
        _childQuestions.Clear();
    }
    public void UpdateStatement(QuestionStatement statement)
    {
        Statement = statement;
    }
    public void UpdateImageUrl( string imageUrl)
    {
        ImageUrl = imageUrl;
    }
    public void UpdateSolution(string solution)
    {
        Solution = solution;
    }

    public void UpdateQuestionStatus(QuestionStatus status)
    {
        Status = status;
    }
}

public class QuestionTag : BaseAuditableEntity<Guid>
{
    public TagName Name { get; set; }
    public TagValue Value { get; set; }

    [Required]
    public Guid QuestionId { get; set; }
    public virtual Question Question{get; set;}
    private QuestionTag() { }
    internal QuestionTag(Guid id, TagName name, TagValue value, Guid questionId)
    {
        Id = id;
        Name = name;
        Value = value;
        QuestionId = questionId;
    }
}
public class QuestionOption : BaseAuditableEntity<Guid>
{
    [Required]
    public OptionName Option {  get; set; }

    [Required]
    public OptionValue IsCorrect {  get; set; }

    [Required]
    public Guid QuestionId { get; set; }
    public virtual Question Question {  get; set; } 
    public virtual ICollection<StudentExam> StudentExams {  get; set; }

    private QuestionOption() { }

    internal QuestionOption(Guid id, OptionName name, OptionValue isCorrect, Guid questionId)
    {
        Id = id;
        Option = name;
        IsCorrect = isCorrect;
        QuestionId = questionId;
    }
}
``` 
4. Is Azure Key Vault configured and accessible from CI for secrets? No, not yet — CI/CD is not set up. 
5. Should Langfuse be cloud-hosted or self-hosted locally? Cloud-hosted
``` 
LANGFUSE_SECRET_KEY="sk-lf-47d77aca-3164-4c32-aa2b-27ad960897fd"
LANGFUSE_PUBLIC_KEY="pk-lf-a29dc9a7-da30-43fa-962d-287ad76f451f"
LANGFUSE_BASE_URL="https://us.cloud.langfuse.com"
```

## Exit Criteria

Phase 0 is complete when:

1. A developer can clone, install, and run the app in under 15 minutes
2. `GET /health` endpoint works and returns correct version info
3. Database connection is tested and working (connection pool configured)
4. Drizzle schema file reflects existing tables from other project
5. CI pipeline passes
6. All tooling (linting, formatting, type-checking) is in place and enforced
7. Pre-commit hooks enforce quality on every commit
8. Observability (Pino, Application Insights, Langfuse) is wired
9. Team agrees Phase 0 is complete — ready to start Phase 1 (Generator service)

## Next Steps (Phase 1)

Phase 1 builds the first LLM integration: stand up NestJS with one endpoint that calls GPT-4o through the Vercel AI SDK and returns a typed Question object. No database writes yet. Goal: prove the LLM round-trip works and Zod schema validation catches malformed output.
