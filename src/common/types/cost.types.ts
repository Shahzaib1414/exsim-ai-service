import { z } from 'zod';

export const LlmUsageSchema = z.object({
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
});

export type TLlmUsage = z.infer<typeof LlmUsageSchema>;

export const ZERO_LLM_USAGE: TLlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export function addLlmUsage(a: TLlmUsage, b: TLlmUsage): TLlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export const GPT4O_PROMPT_COST_PER_1K = 0.005;
export const GPT4O_COMPLETION_COST_PER_1K = 0.015;
