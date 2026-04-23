import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Langfuse from 'langfuse';

@Injectable()
export class LangfuseService implements OnModuleDestroy {
  readonly client: Langfuse;

  constructor(private readonly config: ConfigService) {
    this.client = new Langfuse({
      publicKey: this.config.get<string>('LANGFUSE_PUBLIC_KEY')!,
      secretKey: this.config.get<string>('LANGFUSE_SECRET_KEY')!,
      baseUrl: this.config.get<string>('LANGFUSE_BASE_URL')!,
    });
  }

  async onModuleDestroy() {
    await this.client.shutdownAsync();
  }
}
