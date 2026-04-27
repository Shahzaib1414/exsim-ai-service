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
import { DRIZZLE_CLIENT } from '@/database/database.module';
import { buildEmbeddingText } from '@/common/types';
import type { TQuestion } from '@/common/types';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('@ai-sdk/azure', () => ({
  createAzure: jest.fn(() => jest.fn(() => 'mock-model')),
}));

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      AZURE_OPENAI_RESOURCE: 'my-resource',
      AZURE_OPENAI_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT_GPT4O: 'gpt-4o',
      AZURE_OPENAI_DEPLOYMENT_EMBEDDING: 'text-embedding-3-small',
    };
    return values[key];
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

const mockInsertValues = jest.fn().mockResolvedValue(undefined);
const mockDb = {
  insert: jest.fn(() => ({ values: mockInsertValues })),
};

const validQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: 'Basic arithmetic: 2 + 2 equals 4.',
};

const mockEmbedding = new Array(1536).fill(0.1);
const mockQuestionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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
        { provide: DRIZZLE_CLIENT, useValue: mockDb },
        {
          provide: getLoggerToken(GeneratorService.name),
          useValue: mockLogger,
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
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [] }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({
          extraTags: [
            { name: 'bloomsLevel', value: 'Apply' },
            { name: 'gradeLevel', value: 'Grade 10' },
          ],
        }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertValues.mockResolvedValue(undefined);
    });

    it('should return ok with the generated question', async () => {
      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        ...validQuestion,
        questionId: mockQuestionId,
      });
    });

    it('should call embedText with the combined stem+options text', async () => {
      await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      const expectedText = buildEmbeddingText(
        validQuestion.stem,
        validQuestion.options,
      );
      expect(mockEmbeddingService.embedText).toHaveBeenCalledWith(expectedText);
    });

    it('should call saveQuestion with the question, topic, and difficulty', async () => {
      await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(mockQuestionService.saveQuestion).toHaveBeenCalledWith(
        validQuestion,
        'Arithmetic',
        'Low',
        [
          { name: 'bloomsLevel', value: 'Apply' },
          { name: 'gradeLevel', value: 'Grade 10' },
        ],
      );
    });

    it('should insert embedding with the returned question id', async () => {
      await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

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
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness
        .mockResolvedValueOnce(
          ok({ isUnique: false, similarQuestionIds: ['existing-id'] }),
        )
        .mockResolvedValueOnce(
          ok({ isUnique: false, similarQuestionIds: ['existing-id'] }),
        )
        .mockResolvedValueOnce(ok({ isUnique: true, similarQuestionIds: [] }));
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertValues.mockResolvedValue(undefined);

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isOk()).toBe(true);
      expect(mockDeduplicatorService.checkUniqueness).toHaveBeenCalledTimes(3);
      expect(mockQuestionService.saveQuestion).toHaveBeenCalledTimes(1);
    });

    it('should return err with status 409 when all 3 attempts produce duplicates', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: false, similarQuestionIds: ['existing-id'] }),
      );

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.CONFLICT,
        message: 'failed to generate unique question after 3 attempts',
      });
      expect(mockDeduplicatorService.checkUniqueness).toHaveBeenCalledTimes(3);
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });

    it('should return err immediately when deduplicator service fails', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to check question uniqueness',
        }),
      );

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe(
        'failed to check question uniqueness',
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });
  });

  describe('validator & tagger', () => {
    beforeEach(() => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
    });

    it('should return err with 422 when validator returns isValid=false', async () => {
      mockValidatorService.validate.mockResolvedValue(
        ok({
          isValid: false,
          issues: ['stem is ambiguous', 'distractor too obvious'],
        }),
      );

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

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

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe(
        'failed to validate question',
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });

    it('should pass extraTags from tagger to saveQuestion', async () => {
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [] }),
      );
      mockTaggerService.tag.mockResolvedValue(
        ok({
          extraTags: [
            { name: 'bloomsLevel', value: 'Analyze' },
            { name: 'gradeLevel', value: 'Grade 11' },
          ],
        }),
      );
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertValues.mockResolvedValue(undefined);

      await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(mockQuestionService.saveQuestion).toHaveBeenCalledWith(
        validQuestion,
        'Arithmetic',
        'Low',
        [
          { name: 'bloomsLevel', value: 'Analyze' },
          { name: 'gradeLevel', value: 'Grade 11' },
        ],
      );
    });

    it('should return err when tagger service fails', async () => {
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [] }),
      );
      mockTaggerService.tag.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to tag question',
        }),
      );

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('failed to tag question');
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });
  });

  describe('failure cases', () => {
    it('should return err when generateObject throws, skipping embedding and .NET call', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockRejectedValue(new Error('Schema mismatch'));

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate question',
      });
      expect(mockEmbeddingService.embedText).not.toHaveBeenCalled();
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
    });

    it('should return err and skip .NET call when embedding fails', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to generate embedding',
        }),
      );

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe(
        'failed to generate embedding',
      );
      expect(mockQuestionService.saveQuestion).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should return err and skip embedding write when .NET call fails', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [] }),
      );
      mockTaggerService.tag.mockResolvedValue(ok({ extraTags: [] }));
      mockQuestionService.saveQuestion.mockResolvedValue(
        err({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'failed to save question',
        }),
      );

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('failed to save question');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should return err when embedding DB insert throws', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockResolvedValue({ object: validQuestion } as never);
      mockEmbeddingService.embedText.mockResolvedValue(ok(mockEmbedding));
      mockDeduplicatorService.checkUniqueness.mockResolvedValue(
        ok({ isUnique: true, similarQuestionIds: [] }),
      );
      mockValidatorService.validate.mockResolvedValue(
        ok({ isValid: true, issues: [] }),
      );
      mockTaggerService.tag.mockResolvedValue(ok({ extraTags: [] }));
      mockQuestionService.saveQuestion.mockResolvedValue(
        ok({ id: mockQuestionId }),
      );
      mockInsertValues.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await service.generateOne({
        subject: 'Mathematics',
        topic: 'Arithmetic',
        difficulty: 'Low',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to store question embedding',
      });
    });
  });
});
