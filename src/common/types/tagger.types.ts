import { z } from 'zod';

export const BloomsTaxonomySchema = z.enum([
  'Remember',
  'Understand',
  'Apply',
  'Analyze',
  'Evaluate',
  'Create',
]);

export const TagsResultSchema = z.object({
  bloomsLevel: BloomsTaxonomySchema,
  gradeLevel: z.string(),
});

export type TTagsResult = z.infer<typeof TagsResultSchema>;

export type TExtraTag = { name: string; value: string };
