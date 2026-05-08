import type { FlowJob } from 'bullmq';

export type { FlowJob };

/**
 * Implement this interface on any domain-specific flow config service.
 * The generic BatchFlowService only calls .add(flowJob) — no domain knowledge.
 *
 * Usage:
 *   const flowJob = this.myFlowConfigService.buildMyFlow(args);
 *   await this.batchFlowService.add(flowJob);
 */
export interface IBatchFlowConfig {
  build(): FlowJob;
}
