import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ILangfuseTrace } from '@/common/types';

import type { Config } from '@/config';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  TQuestion,
  TErrorResult,
  buildEmbeddingText,
  TLlmUsage,
  ZERO_LLM_USAGE,
  addLlmUsage,
  McqsQuestionSchema,
  GroupedQuestionSchema,
  OpenEndedQuestionSchema,
  ClosedQuestionSchema,
  TGenerateOneResult,
} from '@/common/types';
import { QuestionType, TQuestionType } from '@/db/schemas/question.schema';
import { BatchType, TBatchType } from '@/db/schemas/question-batch.schema';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { DeduplicatorService } from '@/modules/deduplicator/services/deduplicator.service';
import { ValidatorService } from '@/modules/validator/services/validator.service';
import { TaggerService } from '@/modules/tagger/services/tagger.service';
import { GroundingService } from '@/modules/grounding/services/grounding.service';
import { QuestionEmbeddings } from '@/db/schemas/question-embedding.schema';
import { serializeError, withLlmRetry } from '@/utils';
import { AppInsightsMetricsService } from '@/common/services';
import type { TGenerateOneInput } from '@/common/types';

const MAX_ATTEMPTS = 3;

const QUESTION_SCHEMAS = {
  [QuestionType.Mcqs]: McqsQuestionSchema,
  [QuestionType.Grouped]: GroupedQuestionSchema,
  [QuestionType.Short]: OpenEndedQuestionSchema,
  [QuestionType.Comprehensive]: OpenEndedQuestionSchema,
  [QuestionType.Closed]: ClosedQuestionSchema,
};

const QUESTION_PROMPT_INSTRUCTIONS = {
  [QuestionType.Mcqs]:
    'The question must have exactly 4 distinct answer options. Return the index (0-3) of the correct answer and a brief explanation of why it is correct.',
  [QuestionType.Grouped]:
    'Create a grouped question. If the child questions are based on a shared reading passage, story, or data set, embed the full passage text directly inside the "stem" field (e.g., "Read the following passage:\\n\\n[FULL PASSAGE TEXT]\\n\\nAnswer the questions below."). NEVER reference a passage, story, or data in the stem without including the complete text inline — there is no external attachment. The parent stem must have no answer options. Then create between 2 and 5 child questions, each with exactly 4 distinct answer options and the index (0-3) of the correct answer with an explanation.',
  [QuestionType.Short]:
    'Provide a concise model answer in the solution field. No options required.',
  [QuestionType.Comprehensive]:
    'Provide a detailed, structured model answer in the solution field. No options required.',
  [QuestionType.Closed]:
    'The question must have exactly 2 distinct answer options (e.g. "Yes" / "No", "True" / "False", or another binary pair appropriate to the question). Return the index (0 or 1) of the correct answer and a brief explanation of why it is correct.',
};

@Injectable()
export class GeneratorService extends BaseService<typeof QuestionEmbeddings> {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(GeneratorService.name)
    private readonly logger: PinoLogger,
    private readonly config: ConfigService<Config, true>,
    private readonly embeddingService: EmbeddingService,
    private readonly questionService: QuestionService,
    private readonly deduplicatorService: DeduplicatorService,
    private readonly validatorService: ValidatorService,
    private readonly taggerService: TaggerService,
    private readonly groundingService: GroundingService,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    super(db, QuestionEmbeddings);

    const azure = this.config.get('azure', { infer: true });
    const client = createAzure({
      resourceName: azure.openai.resource,
      apiKey: azure.openai.key,
    });

    this.model = client(azure.openai.deployment);
  }

  async generateOne({
    examType,
    subject,
    topic,
    difficulty,
    grade,
    questionType,
    batchType = BatchType.TEXT,
    negativeExamples = [],
    trace,
  }: TGenerateOneInput & {
    trace?: ILangfuseTrace;
    negativeExamples?: string[];
  }): Promise<Result<TGenerateOneResult, TErrorResult>> {
    // Retrieve grounding context and seed negative examples in parallel — both
    // are independent pre-loop lookups that never abort generation on failure.
    const [groundingContext, topicNegatives] = await Promise.all([
      this.fetchGroundingContext(examType, subject, topic, grade, questionType),
      this.questionService.getRecentQuestionsByTopic(topic, subject),
    ]);

    let accumulatedUsage: TLlmUsage = ZERO_LLM_USAGE;
    // Grows across retries: seeded from caller + recent topic questions + dedup hits
    const activeNegativeExamples: string[] = [
      ...negativeExamples,
      ...topicNegatives,
    ];
    // Carries validator feedback from one attempt into the next generation prompt
    let lastValidationIssues: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Step 1: Generate question via LLM
      const llmResult = await this.callLlm(
        subject,
        topic,
        difficulty,
        grade,
        questionType,
        batchType,
        groundingContext,
        activeNegativeExamples,
        lastValidationIssues,
        trace,
      );
      if (llmResult.isErr()) return err(llmResult.error);
      const { question, usage: llmUsage } = llmResult.value;
      accumulatedUsage = addLlmUsage(accumulatedUsage, llmUsage);

      // Step 2: Generate embedding
      const embeddingText = buildEmbeddingText(question);
      const embeddingResult = await this.embeddingService.embedText(
        embeddingText,
        trace,
      );
      if (embeddingResult.isErr()) return err(embeddingResult.error);
      const { embedding } = embeddingResult.value;

      // Step 3: Deduplication check
      const dedupResult =
        await this.deduplicatorService.checkUniqueness(embedding);
      if (dedupResult.isErr()) {
        return err(dedupResult.error);
      }

      let duplicateQuestionIds: string[] | undefined;

      if (!dedupResult.value.isUnique) {
        this.logger.warn({
          message: 'Duplicate question detected',
          data: {
            attempt,
            similarQuestionIds: dedupResult.value.similarQuestionIds,
          },
        });

        if (attempt < MAX_ATTEMPTS) {
          // Feed duplicate stems into negative examples so the next attempt avoids them
          const similarTexts = await this.questionService.getQuestionTexts(
            dedupResult.value.similarQuestionIds,
          );
          activeNegativeExamples.push(...similarTexts);
          continue;
        }

        duplicateQuestionIds = dedupResult.value.similarQuestionIds;
      }

      // Steps 4+5: Validate and tag in parallel — both receive the same question
      // and are fully independent; running concurrently saves ~1-2s per question.
      const [validationResult, tagResult] = await Promise.all([
        this.validatorService.validate(question, trace),
        this.taggerService.tag(question, subject, topic, difficulty, trace),
      ]);

      if (validationResult.isErr()) return err(validationResult.error);
      if (tagResult.isErr()) return err(tagResult.error);

      accumulatedUsage = addLlmUsage(
        accumulatedUsage,
        addLlmUsage(validationResult.value.usage, tagResult.value.usage),
      );

      if (!validationResult.value.isValid) {
        if (attempt < MAX_ATTEMPTS) {
          // Carry issues into the next generation attempt as corrective feedback
          // (discard tagResult — question will be regenerated)
          lastValidationIssues = validationResult.value.issues;
          this.logger.warn({
            message: 'Question failed validation — retrying with feedback',
            data: { attempt, issues: lastValidationIssues },
          });
          continue;
        }
        trace?.score({
          name: 'question_quality',
          value: 0,
          comment: `Failed validation: ${validationResult.value.issues.join('; ')}`,
        });
        return err({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: `question failed validation: ${validationResult.value.issues.join('; ')}`,
        });
      }

      trace?.score({ name: 'question_quality', value: 1 });

      // Step 6: Save question
      const saveResult = await this.questionService.saveQuestion(
        question,
        topic,
        subject,
        difficulty,
        questionType,
        tagResult.value.extraTags,
        duplicateQuestionIds,
      );
      if (saveResult.isErr()) return err(saveResult.error);
      const { id: questionId } = saveResult.value;

      // Step 7: Store embedding
      const storeResult = await this.storeEmbedding(
        questionId,
        embedding,
        this.embeddingService.modelName,
      );
      if (storeResult.isErr()) {
        this.logger.error({
          message:
            'Embedding write failed after question was saved — orphaned question',
          data: { questionId },
        });
        return err(storeResult.error);
      }

      trace?.update({ output: { questionId } });

      return ok({ questionId, usage: accumulatedUsage });
    }

    // Unreachable — loop always returns, satisfies TypeScript
    return err({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to generate question after max attempts',
    });
  }

  private async fetchGroundingContext(
    examType: string,
    subject: string,
    topic: string,
    grade: number,
    questionType: TQuestionType,
  ): Promise<string[]> {
    try {
      const queryEmbedResult = await this.embeddingService.embedText(
        `${subject} ${topic}`,
      );
      if (queryEmbedResult.isErr()) return [];

      const chunksResult = await this.groundingService.retrieveRelevantChunks(
        queryEmbedResult.value.embedding,
        { examType, subject, grade, questionType },
      );
      return chunksResult.isOk() ? chunksResult.value : [];
    } catch {
      // Grounding failure must never abort generation
      return [];
    }
  }

  private async callLlm(
    subject: string,
    topic: string,
    difficulty: string,
    grade: number,
    questionType: TQuestionType,
    batchType: TBatchType,
    groundingContext: string[] = [],
    negativeExamples: string[] = [],
    validationFeedback: string[] = [],
    trace?: ILangfuseTrace,
  ): Promise<Result<{ question: TQuestion; usage: TLlmUsage }, TErrorResult>> {
    const groundingBlock =
      groundingContext.length > 0
        ? `Use the following syllabus content as context when generating the question:\n<grounding>\n${groundingContext.join('\n\n---\n\n')}\n</grounding>\n\n`
        : '';

    const negativeBlock =
      negativeExamples.length > 0
        ? `\nDo NOT generate a question similar to any of the following existing questions:\n${negativeExamples.map((q, i) => `${i + 1}. "${q}"`).join('\n')}\n`
        : '';

    const feedbackBlock =
      validationFeedback.length > 0
        ? `\nPREVIOUS ATTEMPT REJECTED — a quality auditor found these issues:\n${validationFeedback.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\nYou MUST fix ALL of the above in this new attempt. Do NOT repeat these mistakes.\n`
        : '';

    const latexBlock =
      batchType === BatchType.LATEX
        ? String.raw`FORMAT REQUIREMENTS — LATEX/TIKZ MODE (mandatory, non-negotiable)

1. Every output field (stem, options, solution, explanation) MUST be valid LaTeX.

2. Include a TikZ diagram in the stem IF AND ONLY IF the topic naturally calls for one.
   Topics that need a diagram: geometry, coordinate planes, angles, triangles, graphs of functions, data charts, physics setups, circuit diagrams, number lines.
   Topics that do NOT need a diagram: algebraic manipulation, solving equations, number theory, probability calculations, pure arithmetic.
   Do NOT force a diagram into a symbolic/algebraic topic. Do NOT omit a diagram from a visual topic.

3. ALL visuals MUST be created using ONLY pure TikZ.

4. Allowed environments:
   - \begin{tikzpicture} ... \end{tikzpicture}
   - Inline math: $...$
   - Display math: \[ ... \]

5. STRICTLY FORBIDDEN environments and packages:
   - pgfplots
   - \begin{axis}
   - tabular
   - array
   - matrix
   - pmatrix
   - bmatrix
   - align
   - align*
   - equation
   - cases
   - tikzcd
   - circuitikz

6. DO NOT use:
   - usepackage
   - \documentclass
   - \begin{document}
   - \end{document}

7. The visual MUST be essential to solving the question.
   Students should need to inspect the diagram to answer correctly.

ANTI-PATTERN — STRICTLY FORBIDDEN:
   Do NOT write phrases like "In the figure below", "As shown in the diagram",
   "Refer to the graph", or "See the figure" WITHOUT embedding the TikZ code.
   If a diagram is needed, the TikZ code MUST appear inline inside the stem string.
   There is no external figure. If you reference a diagram, it must be present in the stem.
   Writing a reference phrase without actual TikZ code makes the output INVALID.

8. Preferred TikZ visuals:
   - Coordinate planes
   - Geometry diagrams
   - Angles and triangles
   - Number lines
   - Labeled shapes
   - Simple graphs drawn manually using:
     * \draw
     * \node
     * \fill
     * \coordinate
     * plot coordinates
     * straight line segments

9. If the question would normally require a table,
   represent the information visually using TikZ nodes and lines instead of tabular.

10. If the question would normally require a graph,
    draw it manually with TikZ only.
    NEVER use PGFPLOTS or axis environments.

11. Output must compile correctly in a TikZ-only rendering environment such as node-tikzjax.

12. Do NOT output explanations outside LaTeX strings.

13. Keep TikZ diagrams compact and minimal.
    Avoid advanced libraries or unsupported TikZ features.

14. Example of VALID output:

\begin{tikzpicture}
\draw[->] (-1,0) -- (5,0);
\draw[->] (0,-1) -- (0,5);
\draw (0,0) -- (4,3);
\node at (4.3,3) {A};
\end{tikzpicture}

15. Example of INVALID output:
   - \begin{axis} ... \end{axis}
   - \begin{tabular} ... \end{tabular}
   - \begin{pmatrix} ... \end{pmatrix}

Failure to follow these rules makes the response invalid.
`
        : '';

    const prompt = `${groundingBlock}${latexBlock}${feedbackBlock}Generate a ${questionType} exam question for grade ${grade} students, subject "${subject}", topic "${topic}", difficulty level "${difficulty}".
${QUESTION_PROMPT_INSTRUCTIONS[questionType]}${negativeBlock}`;

    const generation = trace?.generation({
      name: 'llm:generate-question',
      input: { prompt },
    });

    try {
      const result = await withLlmRetry(
        (idempotencyKey) =>
          generateObject({
            model: this.model,
            schema: QUESTION_SCHEMAS[questionType],
            prompt,
            headers: { 'Idempotency-Key': idempotencyKey },
          }),
        {
          onRetry: (attempt) =>
            this.metricsService.trackLlmRetry('generator', attempt),
        },
      );

      const promptTokens = result.usage.inputTokens ?? 0;
      const completionTokens = result.usage.outputTokens ?? 0;
      const usage: TLlmUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };

      generation?.end({
        output: result.object,
        usage: {
          input: usage.promptTokens,
          output: usage.completionTokens,
          total: usage.totalTokens,
        },
      });

      const question = { ...result.object, questionType } as TQuestion;
      return ok({ question, usage });
    } catch (error) {
      generation?.end({ output: { error: serializeError(error) } });
      this.logger.error({
        message: 'Failed to generate question',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate question',
      });
    }
  }

  private async storeEmbedding(
    questionId: string,
    embedding: number[],
    modelName: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      await this.insertOne({
        QuestionId: questionId,
        Embedding: embedding,
        ModelName: modelName,
      });
      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to insert question embedding',
        data: { questionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to store question embedding',
      });
    }
  }
}
