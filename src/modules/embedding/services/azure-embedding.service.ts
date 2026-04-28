import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { embed } from 'ai';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ILangfuseTrace } from '@/common/types';

import { TEnv } from '@/config';
import { serializeError, withLlmRetry } from '@/utils';
import { TErrorResult, EMBEDDING_MODEL_NAME } from '@/common/types';
import { AppInsightsMetricsService } from '@/common/services';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class AzureEmbeddingService extends EmbeddingService {
  private readonly embeddingModel: ReturnType<
    ReturnType<typeof createAzure>['embedding']
  >;

  constructor(
    private readonly config: ConfigService<TEnv, true>,
    @InjectPinoLogger(AzureEmbeddingService.name)
    private readonly logger: PinoLogger,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    super();
    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.embeddingModel = azure.embedding(
      config.get('AZURE_OPENAI_DEPLOYMENT_EMBEDDING'),
    );
  }

  get modelName(): string {
    return EMBEDDING_MODEL_NAME;
  }

  async embedText(
    text: string,
    trace?: ILangfuseTrace,
  ): Promise<Result<{ embedding: number[]; tokens: number }, TErrorResult>> {
    const span = trace?.span({ name: 'embedding:embed-text', input: { text } });

    try {
      const result = await withLlmRetry(
        () => embed({ model: this.embeddingModel, value: text }),
        {
          onRetry: (attempt) =>
            this.metricsService.trackLlmRetry('embedding', attempt),
        },
      );

      const tokens = result.usage?.tokens ?? 0;
      span?.end({ output: { tokens } });

      return ok({ embedding: Array.from(result.embedding), tokens });
    } catch (error) {
      span?.end({ output: { error: serializeError(error) } });
      this.logger.error({
        message: 'Failed to generate embedding',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate embedding',
      });
    }
  }
}
