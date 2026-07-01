import { InjectQueue } from '@nestjs/bullmq';

import { DOCUMENT_INGESTION_QUEUE } from '../queue.constants';

export const InjectDocumentIngestionQueue = (): ParameterDecorator =>
  InjectQueue(DOCUMENT_INGESTION_QUEUE);
