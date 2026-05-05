import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { err, ok, Result } from 'neverthrow';

import type { Config } from '@/config';
import { TErrorResult } from '@/common/types';
import { serializeError } from '@/utils';
import { EmailTemplate, TSendEmailOptions } from '../types/email.types';
import { EmailService } from './email.service';

@Injectable()
export class SmtpEmailService extends EmailService implements OnModuleInit {
  private transporter: nodemailer.Transporter;
  private readonly compiledTemplates = new Map<
    EmailTemplate,
    handlebars.TemplateDelegate
  >();
  private layoutTemplate: handlebars.TemplateDelegate;

  constructor(
    private readonly config: ConfigService<Config, true>,
    @InjectPinoLogger(SmtpEmailService.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  onModuleInit(): void {
    const email = this.config.get('email', { infer: true });

    this.transporter = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure: false,
      auth: {
        user: email.username,
        pass: email.password,
      },
    });

    this.registerPartials();
    this.compileTemplates();
  }

  async send(options: TSendEmailOptions): Promise<Result<void, TErrorResult>> {
    const contentTemplate = this.compiledTemplates.get(options.template);
    if (!contentTemplate) {
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `Unknown email template: ${options.template}`,
      });
    }

    try {
      const body = contentTemplate(options.context);
      const html = this.layoutTemplate({ body, ...options.context });

      await this.transporter.sendMail({
        from: `"ExSim AI" <${this.config.get('email', { infer: true }).from}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html,
      });

      this.logger.info({
        message: 'Email sent',
        data: {
          recipientCount: Array.isArray(options.to) ? options.to.length : 1,
          template: options.template,
        },
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to send email',
        data: { template: options.template },
        error: serializeError(error),
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to send email',
      });
    }
  }

  private registerPartials(): void {
    const partialsDir = join(__dirname, '..', 'templates', 'partials');
    const partials: [string, string][] = [
      ['header', join(partialsDir, 'header.hbs')],
      ['footer', join(partialsDir, 'footer.hbs')],
    ];

    for (const [name, filePath] of partials) {
      handlebars.registerPartial(name, readFileSync(filePath, 'utf8'));
    }

    const layoutSrc = readFileSync(
      join(__dirname, '..', 'templates', 'layout.hbs'),
      'utf8',
    );
    this.layoutTemplate = handlebars.compile(layoutSrc);
  }

  private compileTemplates(): void {
    const templateDir = join(__dirname, '..', 'templates');
    const entries: [EmailTemplate, string][] = [
      [EmailTemplate.QUESTION_BATCH_SUCCESS, 'question-batch-success.hbs'],
      [EmailTemplate.QUESTION_BATCH_FAILURE, 'question-batch-failure.hbs'],
      [
        EmailTemplate.DOCUMENT_INGESTION_SUCCESS,
        'document-ingestion-success.hbs',
      ],
      [
        EmailTemplate.DOCUMENT_INGESTION_FAILURE,
        'document-ingestion-failure.hbs',
      ],
    ];

    for (const [key, filename] of entries) {
      const src = readFileSync(join(templateDir, filename), 'utf8');
      this.compiledTemplates.set(key, handlebars.compile(src));
    }
  }
}
