import { registerAs } from '@nestjs/config';

export interface IDotnetConfig {
  apiUrl: string;
}

export const dotnetConfig = registerAs<IDotnetConfig>('dotnet', () => ({
  apiUrl: process.env.DOTNET_API_URL!,
}));
