import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { analyticsContract } from '@/contracts';
import { AnalyticsService } from '../services/analytics.service';
import { ServerInferRequest } from '@ts-rest/core';
import { toErrorResponse } from '@/utils';

type GenerateAngelReport = ServerInferRequest<
  typeof analyticsContract.generateAngelReport
>;
type GetAngelReport = ServerInferRequest<
  typeof analyticsContract.getAngelReport
>;

@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @TsRestHandler(analyticsContract.generateAngelReport)
  generateAngelReport() {
    return tsRestHandler(
      analyticsContract.generateAngelReport,
      async ({ body }: GenerateAngelReport) => {
        const result = await this.analyticsService.generateAngelReport(body);
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.CREATED, body: result.value };
      },
    );
  }

  @TsRestHandler(analyticsContract.getAngelReport)
  getAngelReport() {
    return tsRestHandler(
      analyticsContract.getAngelReport,
      async ({ params }: GetAngelReport) => {
        const result = await this.analyticsService.getReport(params.sessionId);
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }
}
