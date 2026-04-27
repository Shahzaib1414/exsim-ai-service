import { Global, Module } from '@nestjs/common';

import { ValidatorService } from './services/validator.service';

@Global()
@Module({
  providers: [ValidatorService],
  exports: [ValidatorService],
})
export class ValidatorModule {}
