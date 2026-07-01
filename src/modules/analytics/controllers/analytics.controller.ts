import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { ServerInferRequest } from '@ts-rest/core';

import { analyticsContract } from '@/contracts';
import { toErrorResponse } from '@/utils';
import { AnalyticsService } from '../services/analytics.service';

type GetAngelReport = ServerInferRequest<
  typeof analyticsContract.getAngelReport
>;

@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @TsRestHandler(analyticsContract.requestAngelReport)
  requestAngelReport() {
    return tsRestHandler(analyticsContract.requestAngelReport, async () => {
      const result = await this.analyticsService.requestReport();
      if (result.isErr()) return toErrorResponse(result.error);
      return { status: HttpStatus.CREATED, body: result.value };
    });
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
