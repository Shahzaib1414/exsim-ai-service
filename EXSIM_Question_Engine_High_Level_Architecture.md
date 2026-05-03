**EXSIM Question Engine**

High-Level Architecture

*AI-Powered Scalable Question Generation & Analytics Platform*

Version 1.0 \| MVP Scope

January 2026

# Table of Contents

# 1. Executive Summary

The EXSIM Question Engine is an AI-powered platform designed to automate
the generation of high-quality, globally unique exam questions. The
system addresses the primary scalability bottleneck of manual question
creation and quality assurance by implementing a streamlined AI pipeline
with human oversight at critical checkpoints.

For the MVP, the platform focuses on Victorian Selective Entry exams
covering English (MCQ and open-ended) and Mathematics (MCQ), with
architecture designed to support future expansion to additional
subjects, exam types, and markets.

## 1.1 Key Objectives

  ---------------------------------------------------------------------------
  **Objective**         **Description**
  --------------------- -----------------------------------------------------
  **Scalability**       Generate thousands of unique, high-quality questions
                        without manual effort

  **Quality**           Ensure questions meet exam standards through
                        automated validation and human review

  **Uniqueness**        Guarantee globally unique questions across the entire
                        question bank

  **Personalization**   Deliver real-time, actionable insights to students
                        through the AI Angel analytics agent

  **Extensibility**     Design for easy addition of new subjects, exam types,
                        and AI models
  ---------------------------------------------------------------------------

# 2. Architecture Overview

The architecture follows a layered design pattern with clear separation
of concerns. It integrates with the existing .NET Core API and React
frontend while introducing new AI processing capabilities and a vector
database for content grounding.

## 2.1 System Layers

+-----------------------------------------------------------------------+
| **PRESENTATION LAYER**                                                |
|                                                                       |
| React Frontend (Admin Portal & Student Portal)                        |
+=======================================================================+
| ↕                                                                     |
+-----------------------------------------------------------------------+
| **API LAYER**                                                         |
|                                                                       |
| .NET Core API (Existing) + New AI Endpoints                           |
+-----------------------------------------------------------------------+
| ↕                                                                     |
+-----------------------------------------------------------------------+
| **AI PROCESSING LAYER**                                               |
|                                                                       |
| Question Generation Pipeline \| Validation Engine \| Tagging Service  |
| \| AI Angel                                                           |
+-----------------------------------------------------------------------+
| ↕                                                                     |
+-----------------------------------------------------------------------+
| **DATA LAYER**                                                        |
|                                                                       |
| SQL Server (Existing) \| PostgreSQL + pgvector (New)                  |
+-----------------------------------------------------------------------+
| ↕                                                                     |
+-----------------------------------------------------------------------+
| **EXTERNAL SERVICES**                                                 |
|                                                                       |
| Azure OpenAI (GPT-4o) \| Notification Service (Email)                 |
+-----------------------------------------------------------------------+

# 

# 3. Core Components

## 3.1 Question Generation Pipeline

The pipeline transforms admin input into validated, tagged questions
through a sequence of processing stages. Each stage is designed as an
independent service for maintainability and future scaling.

### Pipeline Flow

  -------------------------------------------------------------------------------------
  **Admin     →   **Generator**   →   **Validator**   →   **Tagger**   →   **Question
  Input**                                                                  Bank**
  ----------- --- --------------- --- --------------- --- ------------ --- ------------

  -------------------------------------------------------------------------------------

  -----------------------------------------------------------------------
  **Stage**       **Description**
  --------------- -------------------------------------------------------
  **1. Admin      Admin selects exam type, subject, topic, difficulty,
  Input**         grade level, quantity, and question format via the
                  existing admin portal.

  **2.            Constructs optimized prompts using admin parameters and
  Generator**     grounding content from vector DB. Generates questions
                  via LLM (GPT-4o). Includes optional LLM-2 critique step
                  if enabled.

  **3.            Applies rule-based checks (structure, options,
  Validator**     explanations) and LLM-based evaluation (grammar,
                  clarity, distractor quality). Failed questions retry up
                  to 3 times before flagging for human review.

  **4. Tagger**   Enriches validated questions with metadata: subject,
                  topic, sub-topic, Bloom\'s taxonomy level, difficulty
                  score, grade level, and question format. Uses LLM for
                  intelligent classification.

  **5. Question   Stores approved questions in SQL Server with full
  Bank**          metadata. Question embeddings stored in pgvector for
                  deduplication and similarity checks.
  -----------------------------------------------------------------------

## 3.2 Human Approval Checkpoints

The pipeline includes strategic human checkpoints to ensure quality
while maintaining efficiency. These checkpoints operate on samples
rather than entire batches to balance oversight with throughput.

  -----------------------------------------------------------------------
  **Checkpoint**    **When**                   **Action**
  ----------------- -------------------------- --------------------------
  **Sample Review** After generating 3-5       Admin reviews samples to
                    sample questions           approve generation pattern
                                               before full batch

  **Failed Question After 3 failed             Admin manually edits or
  Review**          regeneration attempts      discards problematic
                                               questions

  **Batch           After full batch           Admin reviews summary
  Approval**        generation completes       stats and approves batch
                                               for student access
  -----------------------------------------------------------------------

**Recommendation:** While human approval is required per client
specifications, we should probably consider making batch approval
optional for trusted prompt patterns after initial confidence is
established. This can significantly improve throughput without
compromising quality.

## 3.3 AI Angel Analytics Agent

The AI Angel delivers real-time, personalized insights to students after
each test. It replaces static reporting with dynamic, actionable
feedback that drives engagement and learning outcomes.

### Insight Categories

+-----------------+----------------------------------------------------+
| **Category**    | **Example Insights**                               |
+=================+====================================================+
| **Progress      | \"Your accuracy improved 8% over your last three   |
| Tracking**      | tests.\"                                           |
|                 |                                                    |
|                 | \"You\'ve mastered 12 of 15 Number & Algebra       |
|                 | topics.\"                                          |
+-----------------+----------------------------------------------------+
| **Strength      | \"Numerical reasoning remains your strongest area  |
| Analysis**      | at 92% accuracy.\"                                 |
|                 |                                                    |
|                 | \"You excel at word problems requiring multi-step  |
|                 | calculations.\"                                    |
+-----------------+----------------------------------------------------+
| **Weakness      | \"Focus on fraction-to-decimal                     |
| I               | conversions---you\'ve missed 4 of 6 questions on   |
| dentification** | this topic.\"                                      |
|                 |                                                    |
|                 | \"Time management tip: You\'re spending 40% longer |
|                 | on reading comprehension than average.\"           |
+-----------------+----------------------------------------------------+
| **Cohort        | \"You\'re in the top 15% for Year 6 Selective      |
| Comparison**    | Entry Mathematics.\"                               |
|                 |                                                    |
|                 | \"Your verbal reasoning score is 12% above the     |
|                 | cohort average.\"                                  |
+-----------------+----------------------------------------------------+

### Data Flow

1.  **Test Completion:** Student submits test; response data captured
    (answers, time per question, selected options).

2.  **Data Aggregation:** System aggregates student\'s historical
    performance and retrieves cohort benchmarks.

3.  **Insight Generation:** AI Angel (LLM) analyzes data and generates
    personalized insights using structured prompts.

4.  **Delivery:** Insights displayed immediately in UI; optional email
    notification sent.

# 4. Data Architecture

## 4.1 Database Strategy

The architecture uses a dual-database approach: the existing SQL Server
for transactional data and a new PostgreSQL instance with pgvector for
AI-specific workloads.

+-----------------+-------------------------+-------------------------+
| **Database**    | **Purpose**             | **Data Stored**         |
+=================+=========================+=========================+
| **SQL Server**  | Primary transactional   | Users, questions        |
|                 | database for            | (text + metadata), test |
| *(Existing)*    | application data        | sessions, student       |
|                 |                         | responses, batch job    |
|                 |                         | status                  |
+-----------------+-------------------------+-------------------------+
| **PostgreSQL +  | Vector storage for AI   | Question embeddings     |
| pgvector**      | workloads               | (deduplication),        |
|                 |                         | grounding content       |
| *(New)*         |                         | embeddings (exam        |
|                 |                         | patterns, rulebooks)    |
+-----------------+-------------------------+-------------------------+

## 4.2 Grounding Content Store

The system grounds question generation in exam-specific patterns and
rulebooks to ensure generated questions match the target exam\'s style,
difficulty, and format. This approach avoids plagiarism concerns
associated with textbook-based generation.

### Content Ingestion Flow

5.  **Upload:** Admin uploads PDF/document (exam rulebook, past papers,
    style guides).

6.  **Parse:** Document is parsed and chunked into semantic segments.

7.  **Embed:** Each chunk is converted to a vector embedding via Azure
    OpenAI embedding model.

8.  **Store:** Embeddings stored in pgvector with metadata (exam type,
    subject, source document).

## 4.3 Global Question Deduplication

To guarantee globally unique questions, every generated question is
checked against the existing question bank using semantic similarity.

### Deduplication Process

9.  Generate embedding for the new question text.

10. Query pgvector for nearest neighbors (cosine similarity).

11. If similarity score exceeds threshold (e.g., 0.92), flag as
    duplicate.

12. Duplicates are regenerated with modified parameters.

# 5. Technology Stack

  -------------------------------------------------------------------------
  **Layer**           **Technology**             **Rationale**
  ------------------- -------------------------- --------------------------
  **Frontend**        React (Existing)           Existing investment;
                                                 extend with new AI-related
                                                 views

  **API**             .NET Core (Existing)       Add new controllers for AI
                                                 pipeline orchestration

  **AI/LLM**          Azure OpenAI (GPT-4o)      Enterprise-grade,
                                                 Azure-native, strong
                                                 performance across
                                                 subjects

  **Primary DB**      SQL Server (Existing)      Existing investment;
                                                 proven reliability

  **Vector DB**       PostgreSQL + pgvector      Simple, cost-effective,
                                                 sufficient for MVP scale

  **Background Jobs** Azure Functions / Hangfire Batch processing for
                                                 question generation

  **Cloud**           Microsoft Azure            Existing infrastructure;
                                                 native OpenAI integration

  **Notifications**   SendGrid / OneSignal /     Email delivery for AI
                      Azure Communication        Angel insights
                      Services                   
  -------------------------------------------------------------------------

# 6. MVP Scope

## 6.1 In Scope

-   **Subjects:** Mathematics (MCQ), English (MCQ + open-ended)

-   **Exam Type:** Victorian Selective Entry

-   **Question Generation:** Batch-based generation with admin approval
    workflow

-   **Validation:** Automated validation with 3-retry regeneration loop

-   **Tagging:** Subject, topic, difficulty, Bloom\'s taxonomy, grade
    level

-   **Deduplication:** Global uniqueness via vector similarity

-   **AI Angel:** Real-time insights after test completion

-   **Grounding:** PDF/document ingestion for exam patterns

-   **Notifications:** Email delivery of AI Angel insights

## 6.2 Out of Scope (Future Phases)

-   Additional subjects (Sciences, Economics, Law, Medicine)

-   On-demand/adaptive question generation

-   Specialized AI models per subject (DeepSeek for Math, etc.)

-   AI video avatar explainer

-   Screen share / live tutoring

-   B2B features for schools/universities

-   Advanced analytics dashboards (Power BI integration)

# 7. Extension Points

The architecture is designed with clear extension points to support
future growth without requiring significant refactoring.

  -----------------------------------------------------------------------
  **Extension       **How It Enables Future Growth**
  Point**           
  ----------------- -----------------------------------------------------
  **Model           LLM calls are abstracted behind an interface. Swap
  Abstraction**     GPT-4o for DeepSeek (Math) or Claude (English)
                    without pipeline changes.

  **Config-Driven   Validation rules stored in JSON/YAML config. Add new
  Rules**           subjects or exam types by adding config, not code.

  **Prompt          Prompts are parameterized templates stored in DB. Add
  Templates**       new exam styles without code changes.

  **Tag Schema**    Metadata tags are schema-defined. Extend tag
                    dimensions (e.g., misconception patterns) via schema
                    updates.

  **Optional LLM-2  Two-LLM prompt refinement is a feature flag. Enable
  Critique**        for high-stakes exams; disable for cost efficiency.
  -----------------------------------------------------------------------

# 8. Key Design Decisions

  -----------------------------------------------------------------------
  **Decision**    **Choice**                  **Rationale**
  --------------- --------------------------- ---------------------------
  **Single vs     Single LLM (GPT-4o) with    Simplifies MVP; critique
  Multi-LLM**     optional critique step      adds cost without proven
                                              benefit at this stage

  **Batch vs      Batch-only for MVP          Predictable costs; builds
  Real-time**                                 question pool upfront;
                                              real-time adds complexity

  **Grounding     Exam patterns/rulebooks,    Avoids plagiarism concerns;
  Source**        not textbooks               ensures exam-authentic
                                              style

  **Vector DB**   pgvector over Azure AI      Simpler, lower cost,
                  Search                      sufficient for MVP scale

  **MCP           Not used for MVP            Adds complexity; standard
  Protocol**                                  service communication is
                                              sufficient
  -----------------------------------------------------------------------

# 9. Next Steps

13. **Review & Approval:** Review of this high-level architecture

14. **Detailed Architecture:** Create detailed technical design
    including API contracts, database schemas, and sequence diagrams

15. **Prototype:** Build proof-of-concept for question generation
    pipeline

16. **Infrastructure:** Provision PostgreSQL + pgvector instance in
    Azure

17. **Development:** Begin iterative development starting with Generator
    service

*--- End of Document ---*
