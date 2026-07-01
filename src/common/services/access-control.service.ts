import { Injectable } from '@nestjs/common';
import { UserRole } from '@/common/types';

@Injectable()
export class AccessControlService {
  // Student (least) → Operations → Exam_Manager → Administrator (most)
  private readonly hierarchy: Map<UserRole, number> = new Map([
    [UserRole.STUDENT, 1],
    [UserRole.OPERATIONS, 2],
    [UserRole.EXAM_MANAGER, 3],
    [UserRole.ADMINISTRATOR, 4],
  ]);

  isAuthorized(currentRole: UserRole, requiredRole: UserRole): boolean {
    const current = this.hierarchy.get(currentRole);
    const required = this.hierarchy.get(requiredRole);

    if (current === undefined || required === undefined) return false;

    return current >= required;
  }
}
