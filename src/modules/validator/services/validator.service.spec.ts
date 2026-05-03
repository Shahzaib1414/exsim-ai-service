import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import * as aiSdk from 'ai';
import { getLoggerToken } from 'nestjs-pino';

import { ValidatorService } from './validator.service';
import { AppInsightsMetricsService } from '@/common/services';
import { QuestionType } from '@/db/schemas/question.schema';
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
    };
    return values[key];
  }),
};

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};

const validQuestion: TQuestion = {
  stem: 'What is the powerhouse of the cell?',
  options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi apparatus'],
  correctAnswerIndex: 1,
  explanation: 'The mitochondria produces ATP through cellular respiration.',
  questionType: QuestionType.Mcqs,
};

describe('ValidatorService', () => {
  let service: ValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidatorService,
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: getLoggerToken(ValidatorService.name),
          useValue: mockLogger,
        },
        {
          provide: AppInsightsMetricsService,
          useValue: { trackLlmRetry: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ValidatorService>(ValidatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('rule-based checks (no LLM)', () => {
    it('should return isValid=false when options contain duplicates', async () => {
      const question: TQuestion = {
        ...validQuestion,
        options: ['A', 'A', 'C', 'D'],
      };

      const result = await service.validate(question);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.isValid).toBe(false);
      expect(value.issues).toContain('options must all be distinct');
      expect(aiSdk.generateObject).not.toHaveBeenCalled();
    });

    it('should return isValid=false when stem is empty', async () => {
      const question: TQuestion = { ...validQuestion, stem: '   ' };

      const result = await service.validate(question);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().isValid).toBe(false);
      expect(aiSdk.generateObject).not.toHaveBeenCalled();
    });

    it('should return isValid=false when explanation is empty', async () => {
      const question: TQuestion = { ...validQuestion, explanation: '' };

      const result = await service.validate(question);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().isValid).toBe(false);
      expect(aiSdk.generateObject).not.toHaveBeenCalled();
    });
  });

  describe('LLM quality check', () => {
    it('should call generateObject and return its result for a valid question', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: { isValid: true, issues: [] },
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);

      const result = await service.validate(validQuestion);

      expect(aiSdk.generateObject).toHaveBeenCalledTimes(1);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(
        expect.objectContaining({ isValid: true, issues: [] }),
      );
    });

    it('should return isValid=false with issues when LLM flags problems', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: { isValid: false, issues: ['stem is ambiguous'] },
        usage: { inputTokens: 5, outputTokens: 10 },
      } as never);

      const result = await service.validate(validQuestion);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(
        expect.objectContaining({
          isValid: false,
          issues: ['stem is ambiguous'],
        }),
      );
    });

    it('should return err with status 500 when LLM call throws', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockRejectedValue(new Error('Azure timeout'));

      const result = await service.validate(validQuestion);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to validate question',
      });
    });
  });
});
