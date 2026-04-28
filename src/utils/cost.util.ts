import type { TLlmUsage } from '@/common/types';
import {
  GPT4O_COMPLETION_COST_PER_1K,
  GPT4O_PROMPT_COST_PER_1K,
} from '@/common/types';

export function calculateGpt4oCost(usage: TLlmUsage): number {
  const promptCost = (usage.promptTokens / 1000) * GPT4O_PROMPT_COST_PER_1K;
  const completionCost =
    (usage.completionTokens / 1000) * GPT4O_COMPLETION_COST_PER_1K;
  return promptCost + completionCost;
}

export function formatCostUsd(cost: number): string {
  return cost.toFixed(6);
}
