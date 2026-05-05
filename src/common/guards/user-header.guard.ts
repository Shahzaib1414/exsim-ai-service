import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import { roles, userRoles, users } from '@/db/schemas';
import { UnauthorizedErrorInterceptor } from '@/common/interceptors';
import { UserRole, TAuthUserReq } from '@/common/types';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class UserHeaderGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient,
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.headers['x-user-id'];

    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedErrorInterceptor(['Missing x-user-id header']);
    }

    const [row] = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        isActive: users.isActive,
        roleId: roles.id,
        roleName: roles.name,
        email: users.email,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.id, userId), eq(users.isActive, true)))
      .limit(1);

    if (!row) {
      throw new UnauthorizedErrorInterceptor(['User not found or inactive']);
    }

    if (row.roleName !== UserRole.ADMINISTRATOR) {
      throw new UnauthorizedErrorInterceptor([
        'You are not authorized to access this resource',
      ]);
    }

    const user: TAuthUserReq = {
      id: row.id,
      active: row.isActive,
      role: row.roleName as UserRole,
      roleId: row.roleId,
      firstName: row.firstName ?? '',
      lastName: row.lastName ?? '',
      email: row.email,
    };

    this.cls.set('user', user);
    request['user'] = user;

    return true;
  }
}
