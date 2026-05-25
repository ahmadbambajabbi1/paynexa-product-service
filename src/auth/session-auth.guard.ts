import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserSessionService, type SessionUser } from './user-session.service';

export type AuthedRequest = Request & { user: SessionUser };

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: UserSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.headers['authorization'];
    const deviceId = req.headers['x-device-id'];
    const user = await this.sessions.resolveUser(
      typeof auth === 'string' ? auth : undefined,
      typeof deviceId === 'string' ? deviceId : undefined,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid or missing session');
    }
    req.user = user;
    return true;
  }
}
