import { Module } from '@nestjs/common';

import { EmailService } from './services/email.service';
import { SmtpEmailService } from './services/smtp-email.service';

@Module({
  providers: [
    {
      provide: EmailService,
      useClass: SmtpEmailService,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
