import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ok, err } from 'neverthrow';

import { GeneratorController } from './generator.controller';
import { GeneratorService } from '../services/generator.service';
import type { TQuestion } from '@/shared/schemas';
import type { TErrorResult } from '../types/common.types';

type RouteHandler = (args: {
  body: { subject: string; topic: string; difficulty: string };
}) => Promise<{ status: number; body: unknown }>;

const validQuestion: TQuestion = {
  stem: 'What is 2 + 2?',
  options: ['1', '2', '3', '4'],
  correctAnswerIndex: 3,
  explanation: 'Basic arithmetic: 2 + 2 equals 4.',
};

describe('GeneratorController', () => {
  let controller: GeneratorController;
  let generatorService: jest.Mocked<GeneratorService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeneratorController],
      providers: [
        {
          provide: GeneratorService,
          useValue: { generateOne: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<GeneratorController>(GeneratorController);
    generatorService = module.get(GeneratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return status 201 with question on success', async () => {
    generatorService.generateOne.mockResolvedValue(ok(validQuestion));

    const result = controller.generateOne();
    const response = await (result as unknown as RouteHandler)({
      body: { subject: 'Mathematics', topic: 'Arithmetic', difficulty: 'Low' },
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(validQuestion);
  });

  it('should return status 500 when service returns error', async () => {
    const errorResult: TErrorResult = {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to generate question',
    };
    generatorService.generateOne.mockResolvedValue(err(errorResult));

    const result = controller.generateOne();
    const response = await (result as unknown as RouteHandler)({
      body: { subject: 'Mathematics', topic: 'Arithmetic', difficulty: 'Low' },
    });

    expect(response.status).toBe(500);
    expect((response.body as { message: string }).message).toBe(
      HttpStatus[HttpStatus.INTERNAL_SERVER_ERROR],
    );
    expect((response.body as { errors: string[] }).errors).toContain(
      'failed to generate question',
    );
  });
});
