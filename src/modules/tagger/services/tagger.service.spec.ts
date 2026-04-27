import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import * as aiSdk from 'ai';
import { getLoggerToken } from 'nestjs-pino';

import { TaggerService } from './tagger.service';
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
};

describe('TaggerService', () => {
  let service: TaggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaggerService,
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: getLoggerToken(TaggerService.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<TaggerService>(TaggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('tag', () => {
    it('should return extraTags with bloomsLevel and gradeLevel', async () => {
      jest.spyOn(aiSdk, 'generateObject').mockResolvedValue({
        object: { bloomsLevel: 'Remember', gradeLevel: 'Grade 10' },
      } as never);

      const result = await service.tag(
        validQuestion,
        'Biology',
        'Cell Biology',
        'Medium',
      );

      expect(result.isOk()).toBe(true);
      const { extraTags } = result._unsafeUnwrap();
      expect(extraTags).toHaveLength(2);
      expect(extraTags).toContainEqual({
        name: 'bloomsLevel',
        value: 'Remember',
      });
      expect(extraTags).toContainEqual({
        name: 'gradeLevel',
        value: 'Grade 10',
      });
    });

    it('should return err with status 500 when LLM call throws', async () => {
      jest
        .spyOn(aiSdk, 'generateObject')
        .mockRejectedValue(new Error('Azure timeout'));

      const result = await service.tag(
        validQuestion,
        'Biology',
        'Cell Biology',
        'Medium',
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to tag question',
      });
    });
  });
});
