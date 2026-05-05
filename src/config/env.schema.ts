import { z } from 'zod';

const appEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

const redisEnvSchema = z.object({
  REDIS_URL: z.string().min(1),
});

const azureOpenAiEnvSchema = z.object({
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_KEY: z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT_GPT4O: z.string().min(1),
  AZURE_OPENAI_RESOURCE: z.string().min(1),

  AZURE_OPENAI_EMBEDDING_ENDPOINT: z.string().url(),
  AZURE_OPENAI_EMBEDDING_KEY: z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT_EMBEDDING: z.string().min(1),
  AZURE_OPENAI_EMBEDDING_RESOURCE: z.string().min(1),
});

const langfuseEnvSchema = z.object({
  LANGFUSE_PUBLIC_KEY: z.string().min(1),
  LANGFUSE_SECRET_KEY: z.string().min(1),
  LANGFUSE_BASE_URL: z.string().url(),
});

const observabilityEnvSchema = z.object({
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().min(1).optional(),
});

const dotnetEnvSchema = z.object({
  DOTNET_API_URL: z.string().url(),
});

const smtpEnvSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_FROM: z.string().email(),
  SMTP_USERNAME: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
});

const swaggerEnvSchema = z.object({
  SWAGGER_ENABLED: z.string(),
});

export const envSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(azureOpenAiEnvSchema)
  .merge(langfuseEnvSchema)
  .merge(observabilityEnvSchema)
  .merge(dotnetEnvSchema)
  .merge(smtpEnvSchema)
  .merge(swaggerEnvSchema);

export type TEnv = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): TEnv {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
}
