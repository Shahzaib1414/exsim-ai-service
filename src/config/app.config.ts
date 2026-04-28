import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_KEY: z.string().min(1),
  AZURE_OPENAI_EMBEDDING_KEY: z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT_GPT4O: z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT_EMBEDDING: z.string().min(1),
  AZURE_OPENAI_RESOURCE: z.string().min(1),

  LANGFUSE_PUBLIC_KEY: z.string().min(1),
  LANGFUSE_SECRET_KEY: z.string().min(1),
  LANGFUSE_BASE_URL: z.string().url(),

  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().min(1),

  DOTNET_API_URL: z.string().url(),
});

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
