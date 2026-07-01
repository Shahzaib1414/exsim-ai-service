import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { getLoggerToken } from 'nestjs-pino';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import { DEDUP_SIMILARITY_THRESHOLD } from '@/common/types';
import { DeduplicatorService } from './deduplicator.service';

const mockDb = {
  execute: jest.fn(),
};

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};

describe('DeduplicatorService', () => {
  let service: DeduplicatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeduplicatorService,
        { provide: DRIZZLE_CLIENT, useValue: mockDb },
        {
          provide: getLoggerToken(DeduplicatorService.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<DeduplicatorService>(DeduplicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const fakeEmbedding = Array.from({ length: 1536 }, () => 0.1);

  describe('checkUniqueness', () => {
    it('should return isUnique=true when no similar questions are found', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.checkUniqueness(fakeEmbedding);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.isUnique).toBe(true);
      expect(value.similarQuestionIds).toHaveLength(0);
    });

    it('should return isUnique=false with ids when similar questions exist', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [{ QuestionId: 'uuid-1' }, { QuestionId: 'uuid-2' }],
      });

      const result = await service.checkUniqueness(fakeEmbedding);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.isUnique).toBe(false);
      expect(value.similarQuestionIds).toEqual(['uuid-1', 'uuid-2']);
    });

    it('should use the default threshold of 0.90', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      await service.checkUniqueness(fakeEmbedding);

      expect(DEDUP_SIMILARITY_THRESHOLD).toBe(0.9);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('should return err with status 500 when db.execute throws', async () => {
      mockDb.execute.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.checkUniqueness(fakeEmbedding);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to check question uniqueness',
      });
    });
  });
});
