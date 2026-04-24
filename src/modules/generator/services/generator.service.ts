import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';

import { TEnv } from '@/config';
import { QuestionSchema } from '@/shared/schemas';
import { TGenerateOneInputZod, TQuestion } from '../types/generator.types';
import { err, ok, Result } from 'neverthrow';
import { TErrorResult } from '../types/common.types';
import { serializeError } from '@/utils';

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(private readonly config: ConfigService<TEnv, true>) {
    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
      // apiVersion: '2024-05-01-preview',
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async generateOne({
    subject,
    topic,
    difficulty,
  }: TGenerateOneInputZod): Promise<Result<TQuestion, TErrorResult>> {
    const prompt = `Generate a multiple-choice exam question for the subject "${subject}", topic "${topic}", difficulty level "${difficulty}".
The question must have exactly 4 distinct answer options.
Return the index (0-3) of the correct answer and a brief explanation of why it is correct.`;

    try {
      const result = await generateObject({
        model: this.model,
        schema: QuestionSchema,
        prompt,
      });

      return ok(result.object);
    } catch (error) {
      this.logger.error({
        message: 'Failed to generate question',
        data: {
          error: serializeError(error),
        },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate question',
      });
    }
  }
}
