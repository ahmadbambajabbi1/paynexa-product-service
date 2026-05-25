import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  UserSessionService,
  type SessionUser,
} from './user-session.service';

export type OptionalAuthedRequest = Request & { user?: SessionUser };

@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: UserSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OptionalAuthedRequest>();
    const auth = req.headers['authorization'];
    const deviceId = req.headers['x-device-id'];
    const user = await this.sessions.resolveUser(
      typeof auth === 'string' ? auth : undefined,
      typeof deviceId === 'string' ? deviceId : undefined,
    );
    if (user) req.user = user;
    return true;
  }
}
