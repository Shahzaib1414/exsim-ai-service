import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { getLoggerToken } from 'nestjs-pino';

import { QuestionService } from './question.service';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { TCreateQuestionPayload, TQuestion } from '@/common/types';

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      DOTNET_API_URL: 'http://localhost:5001',
    };
    return values[key];
  }),
};

const mockHttpService = {
  post: jest.fn(),
};

const mockDb = {};

const validQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: '2 + 2 equals 4.',
};

const mockQuestionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('QuestionService', () => {
  let service: QuestionService;

  beforeEach(async () => {
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

  it('should return ok({ id }) wrapping the string returned by .NET', async () => {
    mockHttpService.post.mockReturnValue(of({ data: mockQuestionId }));

    const result = await service.saveQuestion(
      validQuestion,
      'Arithmetic',
      'Low',
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: mockQuestionId });
  });

  it('should map question correctly to the .NET payload', async () => {
    mockHttpService.post.mockReturnValue(of({ data: mockQuestionId }));

    await service.saveQuestion(validQuestion, 'Arithmetic', 'Low');

    const [url, payload] = mockHttpService.post.mock.calls[0];
    expect(url).toBe('http://localhost:5001/Questions');
    const { statement, solution, options, tags } =
      payload as TCreateQuestionPayload;
    expect(statement).toBe(validQuestion.stem);
    expect(solution).toBe(validQuestion.explanation);
    expect(options).toHaveLength(4);
    expect(options[3].isCorrect).toBe(true);
    expect(options[0].isCorrect).toBe(false);
    expect(tags).toContainEqual({ name: 'test', value: 'Arithmetic' });
    expect(tags).toContainEqual({ name: 'difficulty', value: 'Low' });
    expect(tags).toContainEqual({ name: 'type', value: 'Mcqs' });
  });

  it('should return err on network error', async () => {
    mockHttpService.post.mockReturnValue(
      throwError(() => new Error('Connection refused')),
    );

    const result = await service.saveQuestion(
      validQuestion,
      'Arithmetic',
      'Low',
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to save question',
    });
  });
});
