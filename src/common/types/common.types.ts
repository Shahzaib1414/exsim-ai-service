import { z } from 'zod';

export enum UserRole {
  ADMINISTRATOR = 'Administrator',
  EXAM_MANAGER = 'Exam_Manager',
  OPERATIONS = 'Operations',
  STUDENT = 'Student',
}

export const AuthUserReqSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  role: z.nativeEnum(UserRole),
  roleId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
});

export type TAuthUserReq = z.infer<typeof AuthUserReqSchema>;

export const PaginationOptionsSchema = z.object({
  page: z.coerce
    .number()
    .transform((val) => (val === 0 ? 1 : val))
    .optional()
    .default(1),
  limit: z.coerce
    .number()
    .transform((val) => (val === 0 ? 10 : val))
    .optional()
    .default(10),
});
export type TPaginationOptions = z.infer<typeof PaginationOptionsSchema>;

export const PaginationMetaSchema = z.object({
  itemCount: z.number().openapi({ example: 1 }),
  totalItems: z.number().optional().openapi({ example: 10 }),
  itemsPerPage: z.number().openapi({ example: 10 }),
  totalPages: z.number().optional().openapi({ example: 1 }),
  currentPage: z.number().openapi({ example: 1 }),
});
export type TPaginationMeta = z.infer<typeof PaginationMetaSchema>;

export type TPaginatedResponse<T> = { items: T[]; meta: TPaginationMeta };
