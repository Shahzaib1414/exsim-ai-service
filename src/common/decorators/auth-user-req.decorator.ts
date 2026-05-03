import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { TAuthUserReq } from '@/common/types';

export const AuthUserReq = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TAuthUserReq => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request['user'] as TAuthUserReq;
  },
);
