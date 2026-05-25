import { Injectable, Logger } from '@nestjs/common';

export type SessionUser = {
  id: string;
  /** Approved lawyer/agent role from user-service, when present. */
  professionalRole: 'LAWYER' | 'AGENT' | null;
};

function parseApprovedProfessionalRole(
  apps: unknown,
): 'LAWYER' | 'AGENT' | null {
  if (!Array.isArray(apps)) {
    return null;
  }
  type App = { role?: string; status?: string; createdAt?: string };
  const approved = apps.filter(
    (a: App) => String(a?.status ?? '').toUpperCase() === 'APPROVED',
  );
  const lawyer = approved.filter(
    (a: App) => String(a?.role ?? '').toUpperCase() === 'LAWYER',
  );
  const agent = approved.filter(
    (a: App) => String(a?.role ?? '').toUpperCase() === 'AGENT',
  );
  const pickLatest = (list: App[]): App | undefined => {
    if (!list.length) return undefined;
    return [...list].sort(
      (a, b) =>
        Date.parse(String(b.createdAt ?? 0)) -
        Date.parse(String(a.createdAt ?? 0)),
    )[0];
  };
  const l = pickLatest(lawyer);
  const g = pickLatest(agent);
  if (l && g) {
    return Date.parse(String(l.createdAt ?? 0)) >=
      Date.parse(String(g.createdAt ?? 0))
      ? 'LAWYER'
      : 'AGENT';
  }
  if (l) return 'LAWYER';
  if (g) return 'AGENT';
  return null;
}

@Injectable()
export class UserSessionService {
  private readonly logger = new Logger(UserSessionService.name);

  async resolveUser(
    authorization: string | undefined,
    deviceId: string | undefined,
  ): Promise<SessionUser | null> {
    if (!authorization?.startsWith('Bearer ') || !deviceId) {
      return null;
    }
    const base = process.env.USER_SERVICE_URL ?? 'http://127.0.0.1:5001';
    const url = new URL('/users/me', base.endsWith('/') ? base : `${base}/`);
    try {
      const r = await fetch(url, {
        headers: {
          authorization,
          'x-device-id': deviceId,
        },
      });
      if (!r.ok) {
        return null;
      }
      const data = (await r.json()) as {
        user?: { id: string; professionalApps?: unknown };
      };
      const id = data.user?.id;
      if (typeof id !== 'string' || !id.length) {
        return null;
      }
      const professionalRole = parseApprovedProfessionalRole(
        data.user?.professionalApps,
      );
      return { id, professionalRole };
    } catch (e) {
      this.logger.warn(`User service unreachable: ${String(e)}`);
      return null;
    }
  }
}
