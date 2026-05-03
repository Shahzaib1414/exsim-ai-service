import z from 'zod';

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
});

export type TAuthUserReq = z.infer<typeof AuthUserReqSchema>;
