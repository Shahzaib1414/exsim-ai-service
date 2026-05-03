**Question Deduplication Flow**

*Ensuring Global Uniqueness in the Question Bank*

1\. Overview

The deduplication mechanism ensures that every question in the EXSIM
question bank is semantically unique. This is achieved through vector
similarity comparison using embeddings stored in pgvector. The system
uses a **post-generation check** approach for MVP, with the architecture
designed to evolve into a hybrid approach as the question bank grows.

1.1 Key Parameters

  ----------------------- -----------------------------------------------
  **Parameter**           **Value**

  **Similarity            **0.90** (cosine similarity). Questions with
  Threshold**             similarity ≥ 0.90 are flagged as duplicates.

  **Max Regeneration      **3 attempts** per question before flagging for
  Attempts**              human review.

  **Embedding Model**     **text-embedding-ada-002** (Azure OpenAI) -
                          1536 dimensions

  **Regeneration          Same parameters with incremented attempt
  Strategy**              counter
  ----------------------- -----------------------------------------------

2\. Sequence Diagram

The following diagram illustrates the complete flow from batch
generation request through deduplication to final storage.

  -------------- --------------- ------------------ -------------- --------------
  **Admin UI**   **Generator**   **Deduplicator**   **pgvector**   **SQL Server**

  -------------- --------------- ------------------ -------------- --------------

  ------- -----------------------------------------------------------------
  **1**   **Admin UI → Generator:** Request batch generation (200 Math
          questions, Year 6, Medium difficulty)

  ------- -----------------------------------------------------------------

  ------- -----------------------------------------------------------------
  **2**   **Generator → LLM (GPT-4o):** Generate question with grounding
          context from vector DB

  ------- -----------------------------------------------------------------

  ------- -----------------------------------------------------------------
  **3**   **Generator → Deduplicator:** Send generated question for
          uniqueness check

  ------- -----------------------------------------------------------------

  ------- -----------------------------------------------------------------
  **4**   **Deduplicator → Embedding API:** Generate embedding vector for
          question text

  ------- -----------------------------------------------------------------

  ------- -----------------------------------------------------------------
  **5**   **Deduplicator → pgvector:** Query for nearest neighbors (cosine
          similarity)

  ------- -----------------------------------------------------------------

  ------- -----------------------------------------------------------------
  **6**   **pgvector → Deduplicator:** Return top-K similar questions with
          similarity scores

  ------- -----------------------------------------------------------------

+-----------------------------------------------------------------------+
| **⟨ DECISION POINT ⟩**                                                |
|                                                                       |
| Is max similarity score ≥ 0.90?                                       |
+-----------------------------------------------------------------------+

+-----------------------------------+-----------------------------------+
| **✓ NO (Unique)**                 | **✗ YES (Duplicate)**             |
|                                   |                                   |
| Proceed to Validator → Tagger →   | Check attempt count\...           |
| Store                             |                                   |
+-----------------------------------+-----------------------------------+

  ----------------------------------- -----------------------------------
                                      **Attempt \< 3?**

  ----------------------------------- -----------------------------------

+-----------------------------------+-----------------+-----------------+
|                                   | **YES**         | **NO**          |
|                                   |                 |                 |
|                                   | ↩ Loop to Step  | Flag for Review |
|                                   | 2               |                 |
|                                   |                 | *Human decides* |
|                                   | *Regenerate*    |                 |
+-----------------------------------+-----------------+-----------------+

3\. Detailed Flow Steps

3.1 Generation Phase

1.  **Batch Initialization:** System creates a batch job record in SQL
    Server with status \'In Progress\', target count (e.g., 200), and
    generation parameters.

2.  **Grounding Retrieval:** Generator queries pgvector for relevant
    exam patterns and rulebook content based on subject/topic. This
    context is included in the prompt.

3.  **LLM Generation:** GPT-4o generates a single question with options,
    correct answer, and explanations. Each question is processed
    individually through the pipeline.

3.2 Deduplication Phase

4.  **Embedding Generation:** The question text (including stem and
    options) is sent to Azure OpenAI\'s embedding API
    (text-embedding-ada-002) to produce a 1536-dimensional vector.

5.  **Similarity Search:** pgvector performs a nearest-neighbor search
    using cosine distance. Query returns the top 5 most similar existing
    questions with their similarity scores.

6.  **Threshold Check:** If the highest similarity score is ≥ 0.90, the
    question is flagged as a potential duplicate.

7.  **Decision Routing:** Unique questions proceed to validation.
    Duplicates enter the regeneration loop.

3.3 Regeneration Loop

8.  **Attempt Tracking:** Each question tracks its regeneration attempt
    count (starts at 1, max 3).

9.  **Regeneration Request:** If attempts \< 3, the Generator is called
    again with the same parameters. The LLM\'s inherent randomness
    (temperature) typically produces a different question.

10. **Loop Continuation:** The new question goes through deduplication
    again. This continues until either a unique question is generated or
    max attempts are reached.

11. **Human Escalation:** After 3 failed attempts, the question is
    flagged for human review with the similar questions that caused the
    conflicts.

3.4 Storage Phase

12. **SQL Server Storage:** Validated and tagged question is stored in
    the Questions table with all metadata (subject, topic, difficulty,
    Bloom\'s level, etc.).

13. **pgvector Storage:** The question\'s embedding vector is stored in
    the question_embeddings table with a foreign key reference to the
    SQL Server question ID.

14. **Batch Progress Update:** Batch job record is updated with
    incremented success/failure counts.

4\. Database Schema (Relevant Tables)

4.1 pgvector: question_embeddings

  ----------------- ----------------- -----------------------------------
  **Column**        **Type**          **Description**

  id                UUID (PK)         Primary key

  question_id       INT               FK to SQL Server Questions.Id

  embedding         vector(1536)      Question text embedding

  subject           VARCHAR(50)       For filtered searches

  created_at        TIMESTAMP         Creation timestamp
  ----------------- ----------------- -----------------------------------

pgvector Index

CREATE INDEX question_embedding_idx ON question_embeddings USING ivfflat
(embedding vector_cosine_ops)

Sample Similarity Query

+-----------------------------------------------------------------------+
| SELECT                                                                |
|                                                                       |
| question_id,                                                          |
|                                                                       |
| 1 - (embedding \<=\> \$1) AS similarity                               |
|                                                                       |
| FROM                                                                  |
|                                                                       |
| question_embeddings                                                   |
|                                                                       |
| WHERE                                                                 |
|                                                                       |
| subject = \$2                                                         |
|                                                                       |
| ORDER BY                                                              |
|                                                                       |
| embedding \<=\> \$1                                                   |
|                                                                       |
| LIMIT 5;                                                              |
+-----------------------------------------------------------------------+

***Note:** The \<=\> operator computes cosine distance. Similarity = 1 -
distance.*

5\. Example Scenario

**Scenario:** Admin requests 200 new Year 6 Mathematics questions. The
question bank already contains 100 Math questions from a previous batch.

  ---------- ------------------------------------------------------------
  **Step**   **Action**

  **1**      Generator creates Question #101: *\"What is 24 × 5?\"*

  **2**      Deduplicator generates embedding vector for the question.

  **3**      pgvector returns nearest match: Question #42 *\"Calculate 24
             multiplied by 5\"* with similarity = **0.94**

  **4**      0.94 ≥ 0.90 threshold → **DUPLICATE DETECTED**. Attempt 1 of
             3.

  **5**      Generator regenerates (Attempt 2): *\"A box contains 24
             apples. If there are 5 boxes, how many apples in total?\"*

  **6**      Deduplicator checks again. Nearest match similarity =
             **0.72**

  **7**      0.72 \< 0.90 threshold → **UNIQUE**. Question proceeds to
             Validator.

  **8**      After validation and tagging, question is stored in SQL
             Server and its embedding in pgvector.

  **9**      Process repeats for remaining 199 questions in the batch.
  ---------- ------------------------------------------------------------

6\. Future Evolution: Hybrid Approach

As the question bank grows (1000+ questions per topic), the
post-generation approach may become inefficient due to increased
duplicate rates. The system can evolve to include **pre-generation
context injection**:

15. **Before generation:** Query pgvector for existing questions
    matching the requested topic/parameters.

16. **Inject context:** Include these questions in the prompt as
    negative examples: \"Generate questions that are NOT similar to
    these\...\"

17. **Generate:** LLM produces questions while \"aware\" of existing
    content.

18. **Safety net:** Post-generation deduplication check remains as a
    final gate.

**Trigger for evolution:** Consider implementing the hybrid approach
when duplicate detection rate exceeds 20% for a given topic, indicating
the LLM\'s random variation is insufficient to avoid collisions.

*--- End of Document ---*
