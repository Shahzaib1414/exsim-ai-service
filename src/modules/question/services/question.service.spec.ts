import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { HttpStatus } from '@nestjs/common';
import { getLoggerToken } from 'nestjs-pino';

import { QuestionService } from './question.service';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import { QuestionType } from '@/db/schemas/question.schema';
import type { TQuestion } from '@/common/types';

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      DOTNET_API_URL: 'http://localhost:5001',
    };
    return values[key];
  }),
};

const mockHttpService = { post: jest.fn() };
const mockQuestionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const validQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: '2 + 2 equals 4.',
  questionType: QuestionType.Mcqs,
};

function buildMockTx(questionId: string) {
  const returningFn = jest.fn().mockResolvedValue([{ Id: questionId }]);
  const valuesFn = jest.fn().mockReturnValue({ returning: returningFn });
  const insertFn = jest.fn().mockReturnValue({ values: valuesFn });
  const limitFn = jest.fn().mockResolvedValue([{ Id: 'existing-id' }]);
  const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn, insert: insertFn, _valuesFn: valuesFn };
}

describe('QuestionService', () => {
  let service: QuestionService;
  let mockDb: { transaction: jest.Mock };

  beforeEach(async () => {
    mockDb = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: HttpService, useValue: mockHttpService },
        { provide: DRIZZLE_CLIENT, useValue: mockDb },
        {
          provide: getLoggerToken(QuestionService.name),
          useValue: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<QuestionService>(QuestionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return ok({ id }) wrapping the question ID from the DB', async () => {
    const tx = buildMockTx(mockQuestionId);
    mockDb.transaction.mockImplementation(
      (fn: (arg: unknown) => Promise<unknown>) => fn(tx),
    );

    const result = await service.saveQuestion(
      validQuestion,
      'Arithmetic',
      'Mathematics',
      'Low',
      QuestionType.Mcqs,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: mockQuestionId });
  });

  it('should insert question with correct statement and solution for Mcqs', async () => {
    const tx = buildMockTx(mockQuestionId);
    mockDb.transaction.mockImplementation(
      (fn: (arg: unknown) => Promise<unknown>) => fn(tx),
    );

    await service.saveQuestion(
      validQuestion,
      'Arithmetic',
      'Mathematics',
      'Low',
      QuestionType.Mcqs,
    );

    // Category and topic already exist (limit returns existing-id),
    // so the first insert call is for the Questions table
    const [questionInsertArgs] = tx._valuesFn.mock.calls[0];
    expect(questionInsertArgs.Statement).toBe(validQuestion.stem);
    expect(questionInsertArgs.Solution).toBe(validQuestion.explanation);
  });

  it('should return err on transaction failure', async () => {
    mockDb.transaction.mockRejectedValue(new Error('Connection refused'));

    const result = await service.saveQuestion(
      validQuestion,
      'Arithmetic',
      'Mathematics',
      'Low',
      QuestionType.Mcqs,
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to save question',
    });
  });
});
