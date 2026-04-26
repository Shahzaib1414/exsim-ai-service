import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import * as aiSdk from 'ai';
import { getLoggerToken } from 'nestjs-pino';

import { EmbeddingService } from './embedding.service';
import { AzureEmbeddingService } from './azure-embedding.service';

jest.mock('ai', () => ({
  embed: jest.fn(),
}));

jest.mock('@ai-sdk/azure', () => ({
  createAzure: jest.fn(() => ({
    embedding: jest.fn(() => 'mock-embedding-model'),
  })),
}));

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      AZURE_OPENAI_RESOURCE: 'my-resource',
      AZURE_OPENAI_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT_EMBEDDING: 'text-embedding-3-small',
    };
    return values[key];
  }),
};

describe('AzureEmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: EmbeddingService, useClass: AzureEmbeddingService },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: getLoggerToken(AzureEmbeddingService.name),
          useValue: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return ok with a number[] on success', async () => {
    const mockVector = new Float32Array(1536).fill(0.1);
    jest
      .spyOn(aiSdk, 'embed')
      .mockResolvedValue({ embedding: mockVector } as never);

    const result = await service.embedText('What is 2+2?');

    expect(result.isOk()).toBe(true);
    const vector = result._unsafeUnwrap();
    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toHaveLength(1536);
  });

  it('should return err with status 500 when embed throws', async () => {
    jest.spyOn(aiSdk, 'embed').mockRejectedValue(new Error('Azure timeout'));

    const result = await service.embedText('What is 2+2?');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to generate embedding',
    });
  });
});
