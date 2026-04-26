import { Result } from 'neverthrow';

import { TErrorResult } from '@/common/types';

export abstract class EmbeddingService {
  abstract get modelName(): string;
  abstract embedText(text: string): Promise<Result<number[], TErrorResult>>;
}
