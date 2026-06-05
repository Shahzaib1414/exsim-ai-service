import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import * as aiSdk from 'ai';
import { ok, err } from 'neverthrow';
import { getLoggerToken } from 'nestjs-pino';

import { GeneratorService } from './generator.service';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { DeduplicatorService } from '@/modules/deduplicator/services/deduplicator.service';
import { ValidatorService } from '@/modules/validator/services/validator.service';
import { TaggerService } from '@/modules/tagger/services/tagger.service';
import { GroundingService } from '@/modules/grounding/services/grounding.service';
import { AppInsightsMetricsService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import { QuestionType } from '@/db/schemas/question.schema';
import { buildEmbeddingText } from '@/common/types';
import type { TQuestion } from '@/common/types';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('@ai-sdk/azure', () => ({
  createAzure: jest.fn(() => jest.fn(() => 'mock-model')),
}));

const mockConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'azure')
      return {
        openai: {
          resource: 'my-resource',
          key: 'test-key',
          deployment: 'gpt-4o',
          endpoint: 'https://my-resource.openai.azure.com',
        },
      };
    return undefined;
  }),
};

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};

const mockEmbeddingService = {
  embedText: jest.fn(),
  modelName: 'text-embedding-3-small',
};

const mockQuestionService = {
  saveQuestion: jest.fn(),
  getQuestionTexts: jest.fn(),
  getRecentQuestionsByTopic: jest.fn().mockResolvedValue([]),
};

const mockDeduplicatorService = {
  checkUniqueness: jest.fn(),
};

const mockValidatorService = {
  validate: jest.fn(),
};

const mockTaggerService = {
  tag: jest.fn(),
};

const mockGroundingService = {
  retrieveRelevantChunks: jest.fn().mockResolvedValue(ok([])),
};

const mockInsertReturning = jest.fn().mockResolvedValue([]);
const mockInsertValues = jest.fn(() => ({ returning: mockInsertReturning }));
const mockDb = {
  insert: jest.fn(() => ({ values: mockInsertValues })),
};

const validQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: 'Basic arithmetic: 2 + 2 equals 4.',
  questionType: QuestionType.Mcqs,
};

const mockEmbedding = new Array(1536).fill(0.1);
const mockQuestionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const baseGenerateOneInput = {
  examType: 'Victorian Selective',
  subject: 'Mathematics',
  topic: 'Arithmetic',
  difficulty: 'Low' as const,
  grade: 6,
  questionType: QuestionType.Mcqs,
};

describe('GeneratorService', () => {
  let service: GeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneratorService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: QuestionService, useValue: mockQuestionService },
        { provide: DeduplicatorService, useValue: mockDeduplicatorService },
        { provide: ValidatorService, useValue: mockValidatorService },
        { provide: TaggerService, useValue: mockTaggerService },
        { provide: GroundingService, useValue: mockGroundingService },
        { provide: DRIZZLE_CLIENT, useValue: mockDb },
        {
          provide: getLoggerToken(GeneratorService.name),
          useValue: mockLogger,
        },
        {
          provide: AppInsightsMetricsService,
          useValue: {
            trackBatchItemSuccess: jest.fn(),
            trackBatchItemFailure: jest.fn(),
            trackLlmTokenUsage: jest.fn(),
            trackLlmRetry: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GeneratorService>(GeneratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('happy path', () => {
    beforeEach(() => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({
          extraTags: [
            { name: 'bloomsLevel', value: 'Apply' },
            { name: 'gradeLevel', value: 'Grade 10' },
          ],
          usage: zeroUsage,
        }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertReturning.mockResolvedValue([]);
    });

    it('should return ok with questionId and usage', async () => {
      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(
        expect.objectContaining({ questionId: mockQuestionId }),
      );
    });

    it('should call embedText with the combined stem+options text', async () => {
      await service.generateOne(baseGenerateOneInput);

      const expectedText = buildEmbeddingText(validQuestion);
      expect(mockEmbeddingService.embedText).toHaveBeenCalledWith(
        expectedText,
        undefined,
      );
    });

    it('should call saveQuestion with the question, topic, subject, difficulty, and questionType', async () => {
      await service.generateOne(baseGenerateOneInput);

      expect(mockQuestionService.saveQuestion).toHaveBeenCalledWith(
        validQuestion,
        'Arithmetic',
        'Mathematics',
        'Low',
        QuestionType.Mcqs,
        [
          { name: 'bloomsLevel', value: 'Apply' },
          { name: 'gradeLevel', value: 'Grade 10' },
        ],
        undefined,
      );
    });

    it('should insert embedding with the returned question id', async () => {
      await service.generateOne(baseGenerateOneInput);

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          QuestionId: mockQuestionId,
          Embedding: mockEmbedding,
          ModelName: 'text-embedding-3-small',
        }),
      );
    });
  });

  describe('deduplication retry loop', () => {
    it('should retry and succeed when duplicate on first 2 attempts then unique on 3rd', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness
        .mockResolvedValueOnce(
          ok({ isUnique: false, similarQuestionIds: ['existing-id'] }),
        )
        .mockResolvedValueOnce(
          ok({ isUnique: false, similarQuestionIds: ['existing-id'] }),
        )
        .mockResolvedValueOnce(ok({ isUnique: true, similarQuestionIds: [] }));
      mockQuestionService.getQuestionTexts.mockResolvedValue([
        'Existing similar question text',
      ]);
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({ extraTags: [], usage: zeroUsage }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertReturning.mockResolvedValue([]);

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isOk()).toBe(true);
      expect(mockDeduplicatorService.checkUniqueness).toHaveBeenCalledTimes(3);
      expect(mockQuestionService.saveQuestion).toHaveBeenCalledTimes(1);
    });

    it('should save as Duplicate and return ok when all 3 attempts produce duplicates', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: false, similarQuestionIds: ['existing-id'] }),
      );
      mockQuestionService.getQuestionTexts.mockResolvedValue([]);
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({ extraTags: [], usage: zeroUsage }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertReturning.mockResolvedValue([]);

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(
        expect.objectContaining({ questionId: mockQuestionId }),
      );
      expect(mockDeduplicatorService.checkUniqueness).toHaveBeenCalledTimes(3);
      // Question is saved with duplicate IDs on the 3rd attempt
      expect(mockQuestionService.saveQuestion).toHaveBeenCalledTimes(1);
    });

    it('should return err immediately when deduplicator service fails', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to check question uniqueness',
        }),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe(
        'failed to check question uniqueness',
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });
  });

  describe('validator & tagger', () => {
    beforeEach(() => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      // tag runs in parallel with validate — must always return a valid response
      mockTaggerService.tag.mockResolvedValue(
        ok({ extraTags: [], usage: zeroUsage }),
      );
    });

    it('should return err with 422 when validator returns isValid=false', async () => {
      mockValidatorService.validate.mockResolvedValue(
        ok({
          isValid: false,
          issues: ['stem is ambiguous', 'distractor too obvious'],
          usage: zeroUsage,
        }),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });

    it('should return err when validator service itself fails', async () => {
      mockValidatorService.validate.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to validate question',
        }),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe(
        'failed to validate question',
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });

    it('should pass extraTags from tagger to saveQuestion', async () => {
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({
          extraTags: [
            { name: 'bloomsLevel', value: 'Analyze' },
            { name: 'gradeLevel', value: 'Grade 11' },
          ],
          usage: zeroUsage,
        }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertReturning.mockResolvedValue([]);

      await service.generateOne(baseGenerateOneInput);

      expect(mockQuestionService.saveQuestion).toHaveBeenCalledWith(
        validQuestion,
        'Arithmetic',
        'Mathematics',
        'Low',
        QuestionType.Mcqs,
        [
          { name: 'bloomsLevel', value: 'Analyze' },
          { name: 'gradeLevel', value: 'Grade 11' },
        ],
        undefined,
      );
    });

    it('should return err when tagger service fails', async () => {
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to tag question',
        }),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('failed to tag question');
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });
  });

  describe('failure cases', () => {
    it('should return err when generateObject throws, skipping embedding and save', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockRejectedValue(new Error('Schema mismatch'));

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate question',
      });
      expect(mockEmbeddingService.embedText).not.toHaveBeenCalledWith(
        buildEmbeddingText(validQuestion),
        undefined,
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });

    it('should return err and skip save when embedding fails', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to generate embedding',
        }),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe(
        'failed to generate embedding',
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should return err and skip embedding write when saveQuestion fails', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({ extraTags: [], usage: zeroUsage }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to save question',
        }),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('failed to save question');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should return err when embedding DB insert throws', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: validQuestion,
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        ok({ embedding: mockEmbedding, tokens: 10 }),
      );
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [], usage: zeroUsage }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({ extraTags: [], usage: zeroUsage }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertReturning.mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      const result = await service.generateOne(baseGenerateOneInput);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to store question embedding',
      });
    });
  });
});
