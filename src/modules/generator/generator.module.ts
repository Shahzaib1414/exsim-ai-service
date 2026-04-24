import { Module } from '@nestjs/common';

import { GeneratorController } from './controllers/generator.controller';
import { GeneratorService } from './services/generator.service';

@Module({
  controllers: [GeneratorController],
  providers: [GeneratorService],
})
export class GeneratorModule {}
