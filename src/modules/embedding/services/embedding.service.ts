import { Result } from 'neverthrow';

import { TErrorResult, ILangfuseTrace } from '@/common/types';

export abstract class EmbeddingService {
  abstract get modelName(): string;
  abstract embedText(
    text: string,
    trace?: ILangfuseTrace,
  ): Promise<Result<{ embedding: number[]; tokens: number }, TErrorResult>>;
}
