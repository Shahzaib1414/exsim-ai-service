import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { embed } from 'ai';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { TEnv } from '@/config';
import { serializeError } from '@/utils';
import { TErrorResult, EMBEDDING_MODEL_NAME } from '@/common/types';
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

  async embedText(text: string): Promise<Result<number[], TErrorResult>> {
    try {
      const result = await embed({ model: this.embeddingModel, value: text });
      return ok(Array.from(result.embedding));
    } catch (error) {
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
