import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Langfuse from 'langfuse';

import type { Config } from '@/config';

@Injectable()
export class LangfuseService implements OnModuleDestroy {
  readonly client: Langfuse;

  constructor(private readonly config: ConfigService<Config, true>) {
    const langfuse = this.config.get('langfuse', { infer: true });
    this.client = new Langfuse({
      publicKey: langfuse.publicKey,
      secretKey: langfuse.secretKey,
      baseUrl: langfuse.baseUrl,
    });
  }

  async onModuleDestroy() {
    await this.client.shutdownAsync();
  }
}
