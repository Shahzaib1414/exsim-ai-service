import { Result } from 'neverthrow';

import { TErrorResult } from '@/common/types';
import { TSendEmailOptions } from '../types/email.types';

export abstract class EmailService {
  abstract send(
    options: TSendEmailOptions,
  ): Promise<Result<void, TErrorResult>>;
}
