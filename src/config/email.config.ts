import { registerAs } from '@nestjs/config';

export interface IEmailConfig {
  host: string;
  port: number;
  from: string;
  username: string;
  password: string;
}

export const emailConfig = registerAs<IEmailConfig>('email', () => ({
  host: process.env.SMTP_HOST ?? '',
  port: Number(process.env.SMTP_PORT ?? 587),
  from: process.env.SMTP_FROM ?? '',
  username: process.env.SMTP_USERNAME ?? '',
  password: process.env.SMTP_PASSWORD ?? '',
}));
