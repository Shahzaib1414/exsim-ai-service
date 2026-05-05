import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { initContract } from '@ts-rest/core';
import { generateOpenApi } from '@ts-rest/open-api';

import {
  generatorContract,
  questionBatchContract,
  groundingContract,
  analyticsContract,
} from '@/contracts';

const c = initContract();

// Root contract that combines all feature contracts.
// Each sub-contract already has its own pathPrefix defined.
const apiContract = c.router({
  generator: generatorContract,
  questionBatch: questionBatchContract,
  grounding: groundingContract,
  analytics: analyticsContract,
});

export function setupSwagger(app: INestApplication, baseUrl: string): void {
  const documentBuilder = new DocumentBuilder()
    .setTitle('ExSim AI Service')
    .setDescription('AI service for exam question generation and management')
    .setVersion('1.0')
    .addServer(baseUrl)
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-user-id' }, 'x-user-id')
    .build();

  const document = generateOpenApi(apiContract, documentBuilder, {
    setOperationId: true,
  });

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
