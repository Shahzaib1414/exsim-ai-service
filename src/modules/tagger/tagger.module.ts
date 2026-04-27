import { Global, Module } from '@nestjs/common';

import { TaggerService } from './services/tagger.service';

@Global()
@Module({
  providers: [TaggerService],
  exports: [TaggerService],
})
export class TaggerModule {}
