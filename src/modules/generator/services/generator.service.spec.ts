import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import * as aiSdk from 'ai';
import { ok, err } from 'neverthrow';

import { GeneratorService } from './generator.service';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { QuestionService } from '@/modules/question/services/question.service';
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

const mockEmbeddingService = {
  embedText: jest.fn(),
  modelName: 'text-embedding-3-small',
};

const mockQuestionService = {
  saveQuestion: jest.fn(),
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
        { provide: DRIZZLE_CLIENT, useValue: mockDb },
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
      expect(result._unsafeUnwrap()).toEqual(validQuestion);
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
