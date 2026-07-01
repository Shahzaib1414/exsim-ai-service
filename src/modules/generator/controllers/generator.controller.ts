import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { generatorContract } from '@/contracts';
import { GeneratorService } from '../services/generator.service';
import { ServerInferRequest } from '@ts-rest/core';
import { toErrorResponse } from '@/utils';

type GenerateOne = ServerInferRequest<typeof generatorContract.generateOne>;

@Controller()
export class GeneratorController {
  constructor(private readonly generatorService: GeneratorService) {}

  @TsRestHandler(generatorContract.generateOne)
  generateOne() {
    return tsRestHandler(
      generatorContract.generateOne,
      async ({ body }: GenerateOne) => {
        const result = await this.generatorService.generateOne(body);
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.CREATED, body: result.value };
      },
    );
  }
}
