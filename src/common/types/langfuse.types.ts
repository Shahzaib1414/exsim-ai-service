/**
 * Minimal interface for Langfuse trace operations used by services.
 * Using a local interface instead of importing directly from 'langfuse'
 * avoids triggering ESM dynamic imports in test environments.
 */

export interface ILangfuseGeneration {
  end(params?: {
    output?: unknown;
    usage?: { input?: number; output?: number; total?: number };
  }): void;
}

export interface ILangfuseSpan {
  end(params?: { output?: unknown }): void;
}

export interface ILangfuseTrace {
  generation(params: { name: string; input?: unknown }): ILangfuseGeneration;
  span(params: { name: string; input?: unknown }): ILangfuseSpan;
  update(params: { output?: unknown }): void;
  score(params: { name: string; value: number; comment?: string }): void;
}
