import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Name, email, phone, etc. from user-service for marketplace flows (not duplicated on ServiceProvider). */
export type MarketplaceUserContact = {
  id: string;
  displayName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  countryCode: string | null;
};

@Injectable()
export class MarketplaceUserSummaryClient {
  private readonly logger = new Logger(MarketplaceUserSummaryClient.name);

  constructor(private readonly config: ConfigService) {}

  async fetchSummaries(
    userIds: string[],
  ): Promise<Map<string, MarketplaceUserContact>> {
    const out = new Map<string, MarketplaceUserContact>();
    const unique = Array.from(new Set(userIds.filter(Boolean))).slice(0, 48);
    if (!unique.length) return out;

    const base = (
      this.config.get<string>('USER_SERVICE_URL')?.trim() ||
      'http://127.0.0.1:5001'
    ).replace(/\/$/, '');
    const secret =
      this.config.get<string>('SERVICE_MARKETPLACE_INTERNAL_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_API_SECRET')?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : 'change-me');

    if (!secret?.length) {
      this.logger.warn(
        'SERVICE_MARKETPLACE_INTERNAL_SECRET missing; skipping marketplace user contact fetch',
      );
      return out;
    }

    const url = new URL('/internal/service-marketplace-users/summaries', `${base}/`);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-marketplace-internal-secret': secret,
        },
        body: JSON.stringify({ userIds: unique }),
      });
      if (!r.ok) {
        this.logger.warn(`user-summaries failed: HTTP ${r.status}`);
        return out;
      }
      const body = (await r.json()) as {
        users?: MarketplaceUserContact[];
      };
      for (const u of body.users ?? []) {
        if (u?.id) out.set(u.id, u);
      }
    } catch (e) {
      this.logger.warn(`user-summaries error: ${String(e)}`);
    }
    return out;
  }
}
