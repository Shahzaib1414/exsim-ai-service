import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import * as aiSdk from 'ai';

import { GeneratorService } from './generator.service';
import type { TQuestion } from '@/shared/schemas';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

jest.mock('@ai-sdk/azure', () => ({
  createAzure: jest.fn(() => jest.fn(() => 'mock-model')),
}));

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      AZURE_OPENAI_ENDPOINT: 'https://my-resource.openai.azure.com/',
      AZURE_OPENAI_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT_GPT4O: 'gpt-4o',
    };
    return values[key];
  }),
};

const validQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: 'Basic arithmetic: 2 + 2 equals 4.',
};

describe('GeneratorService', () => {
  let service: GeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneratorService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<GeneratorService>(GeneratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return a valid question on happy path', async () => {
    jest
      .spyOn(aiSdk, 'generateObject')
      .mockResolvedValue({ object: validQuestion } as never);

    const result = await service.generateOne({
      subject: 'Mathematics',
      topic: 'Arithmetic',
      difficulty: 'Low',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(validQuestion);
  });

  it('should return an error result when generateObject throws', async () => {
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
  });
});
