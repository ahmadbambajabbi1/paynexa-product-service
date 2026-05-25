import { Global, Module } from '@nestjs/common';
import { OptionalSessionAuthGuard } from './optional-session-auth.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { UserSessionService } from './user-session.service';

@Global()
@Module({
  providers: [
    UserSessionService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
  ],
  exports: [
    UserSessionService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
  ],
})
export class AuthModule {}
