import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { HttpStatus } from '@nestjs/common';
import { getLoggerToken } from 'nestjs-pino';

import { QuestionService } from './question.service';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import { QuestionStatus, QuestionType } from '@/db/schemas/question.schema';
import type { TQuestion } from '@/common/types';

const mockConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'dotnet') return { apiUrl: 'http://localhost:5001' };
    return undefined;
  }),
};

const mockHttpService = { post: jest.fn() };
const mockQuestionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const mcqsQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: '2 + 2 equals 4.',
  questionType: QuestionType.Mcqs,
};

const groupedQuestion: TQuestion = {
  stem: 'Answer the following questions about addition.',
  questionType: QuestionType.Grouped,
  childQuestions: [
    {
      stem: 'What is 1 + 1?',
      options: ['1', '2', '3', '4'],
      correctAnswerIndex: 1,
      explanation: '1 + 1 equals 2.',
    },
    {
      stem: 'What is 2 + 2?',
      options: ['1', '2', '3', '4'],
      correctAnswerIndex: 3,
      explanation: '2 + 2 equals 4.',
    },
  ],
};

/**
 * Builds a mock Drizzle transaction.
 *
 * select chain: resolves with [{ Id: existingId }] by default so
 * resolveCategory / resolveTopic take the "already exists" path.
 *
 * insert chain: .values() returns a thenable so `await tx.insert().values()`
 * works for options/tags (no .returning()), and .returning() is also
 * available for the Questions insert.
 */
function buildMockTx(questionId: string, existingId = 'existing-id') {
  const returningFn = jest.fn().mockResolvedValue([{ Id: questionId }]);

  // valuesFn must itself be a Promise so direct `await tx.insert(x).values(y)`
  // resolves, AND expose .returning() for the Questions insert.
  const valuesFn = jest.fn().mockReturnValue(
    Object.assign(Promise.resolve([{ Id: questionId }]), {
      returning: returningFn,
    }),
  );

  const insertFn = jest.fn().mockReturnValue({ values: valuesFn });

  const limitFn = jest.fn().mockResolvedValue([{ Id: existingId }]);
  const whereFn = jest.fn().mockReturnValue({ limit: limitFn });
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });

  return {
    select: selectFn,
    insert: insertFn,
    _valuesFn: valuesFn,
    _insertFn: insertFn,
  };
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

  afterEach(() => jest.clearAllMocks());

  describe('saveQuestion - MCQS', () => {
    it('should return ok({ id }) wrapping the question ID from the DB', async () => {
      const tx = buildMockTx(mockQuestionId);
      mockDb.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      const result = await service.saveQuestion(
        mcqsQuestion,
        'Arithmetic',
        'Mathematics',
        'Low',
        QuestionType.Mcqs,
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ id: mockQuestionId });
    });

    it('should insert question with correct statement and solution', async () => {
      const tx = buildMockTx(mockQuestionId);
      mockDb.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      await service.saveQuestion(
        mcqsQuestion,
        'Arithmetic',
        'Mathematics',
        'Low',
        QuestionType.Mcqs,
      );

      // Category and topic already exist, so first insert is the Questions row
      const [questionInsertArgs] = tx._valuesFn.mock.calls[0];
      expect(questionInsertArgs.Statement).toBe(mcqsQuestion.stem);
      expect(questionInsertArgs.Solution).toBe(mcqsQuestion.explanation);
      expect(questionInsertArgs.Status).toBe(QuestionStatus.Draft);
    });

    it('should insert options after the question row', async () => {
      const tx = buildMockTx(mockQuestionId);
      mockDb.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      await service.saveQuestion(
        mcqsQuestion,
        'Arithmetic',
        'Mathematics',
        'Low',
        QuestionType.Mcqs,
      );

      // calls[0] = Questions row, calls[1] = options batch
      const [optionsInsertArgs] = tx._valuesFn.mock.calls[1];
      expect(optionsInsertArgs).toHaveLength(4);
      expect(optionsInsertArgs[3]).toMatchObject({
        IsCorrect: true,
        QuestionId: mockQuestionId,
      });
    });

    it('should mark question as Duplicate when duplicateQuestionIds supplied', async () => {
      const tx = buildMockTx(mockQuestionId);
      mockDb.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      await service.saveQuestion(
        mcqsQuestion,
        'Arithmetic',
        'Mathematics',
        'Low',
        QuestionType.Mcqs,
        [],
        ['dup-id-1', 'dup-id-2'],
      );

      const [questionInsertArgs] = tx._valuesFn.mock.calls[0];
      expect(questionInsertArgs.Status).toBe(QuestionStatus.Duplicate);
      expect(questionInsertArgs.DuplicateQuestionIds).toBe('dup-id-1,dup-id-2');
    });
  });

  describe('saveQuestion - Grouped', () => {
    it('should insert parent and each child question', async () => {
      const childId1 = 'child-id-0001';
      const tx = buildMockTx(childId1);
      // First .returning() call (parent) returns parent id; subsequent calls return child ids
      tx._insertFn.mockReturnValue({ values: tx._valuesFn });

      // Make returning resolve with parent id on first call, child id on subsequent
      const parentId = 'parent-id-0001';
      tx._valuesFn
        .mockReturnValueOnce(
          Object.assign(Promise.resolve([{ Id: parentId }]), {
            returning: jest.fn().mockResolvedValue([{ Id: parentId }]),
          }),
        )
        .mockReturnValue(
          Object.assign(Promise.resolve([{ Id: childId1 }]), {
            returning: jest.fn().mockResolvedValue([{ Id: childId1 }]),
          }),
        );

      mockDb.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      const result = await service.saveQuestion(
        groupedQuestion,
        'Algebra',
        'Mathematics',
        'Medium',
        QuestionType.Grouped,
      );

      expect(result.isOk()).toBe(true);
      // parent + 2 children = 3 Questions inserts (+ tags for each)
      const questionInserts = tx._insertFn.mock.calls.length;
      expect(questionInserts).toBeGreaterThanOrEqual(3);
    });

    it('should set ParentQuestionId on child rows', async () => {
      const parentId = 'parent-id-0001';
      let insertCallIndex = 0;

      const makeValuesFn = () => {
        const fn = jest.fn().mockImplementation(() => {
          const id = insertCallIndex === 0 ? parentId : 'child-id';
          insertCallIndex++;
          return Object.assign(Promise.resolve([{ Id: id }]), {
            returning: jest.fn().mockResolvedValue([{ Id: id }]),
          });
        });
        return fn;
      };

      const valuesFn = makeValuesFn();
      const tx = {
        insert: jest.fn().mockReturnValue({ values: valuesFn }),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ Id: 'existing-id' }]),
            }),
          }),
        }),
        _valuesFn: valuesFn,
      };

      mockDb.transaction.mockImplementation(
        (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      );

      await service.saveQuestion(
        groupedQuestion,
        'Algebra',
        'Mathematics',
        'Medium',
        QuestionType.Grouped,
      );

      // calls[0] = parent Questions insert (no ParentQuestionId)
      // calls[1] = parent tags insert
      // calls[2] = first child Questions insert
      const childInsertArgs = valuesFn.mock.calls.find(
        ([args]: [Record<string, unknown>]) =>
          args?.ParentQuestionId === parentId,
      );
      expect(childInsertArgs).toBeDefined();
    });
  });

  describe('saveQuestion - error handling', () => {
    it('should return err on transaction failure', async () => {
      mockDb.transaction.mockRejectedValue(new Error('Connection refused'));

      const result = await service.saveQuestion(
        mcqsQuestion,
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
});
