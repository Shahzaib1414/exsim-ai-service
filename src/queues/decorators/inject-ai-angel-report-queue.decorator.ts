import { InjectQueue } from '@nestjs/bullmq';

import { AI_ANGEL_REPORT_QUEUE } from '../queue.constants';

export const InjectAiAngelReportQueue = (): ParameterDecorator =>
  InjectQueue(AI_ANGEL_REPORT_QUEUE);
