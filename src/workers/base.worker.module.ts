import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { EmailModule } from '@/modules/email';

@Global()
@Module({
  imports: [ConfigModule.forRoot(), LoggerModule, EmailModule],
  exports: [EmailModule],
})
export class BaseWorkerModule {}
