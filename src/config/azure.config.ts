import { registerAs } from '@nestjs/config';

export interface IAzureOpenAiConfig {
  endpoint: string;
  key: string;
  deployment: string;
  resource: string;
}

export interface IAzureConfig {
  openai: IAzureOpenAiConfig;
  embedding: IAzureOpenAiConfig;
}

export const azureConfig = registerAs<IAzureConfig>('azure', () => ({
  openai: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    key: process.env.AZURE_OPENAI_KEY ?? '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O ?? '',
    resource: process.env.AZURE_OPENAI_RESOURCE ?? '',
  },
  embedding: {
    endpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT ?? '',
    key: process.env.AZURE_OPENAI_EMBEDDING_KEY ?? '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING ?? '',
    resource: process.env.AZURE_OPENAI_EMBEDDING_RESOURCE ?? '',
  },
}));
