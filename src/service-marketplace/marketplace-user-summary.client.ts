import { Injectable, Logger } from '@nestjs/common';
import { RabbitmqService } from '../infrastructure/rabbitmq/rabbitmq.service';

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

  constructor(private readonly rabbit: RabbitmqService) {}

  async fetchSummaries(
    userIds: string[],
  ): Promise<Map<string, MarketplaceUserContact>> {
    const out = new Map<string, MarketplaceUserContact>();
    const unique = Array.from(new Set(userIds.filter(Boolean))).slice(0, 48);
    if (!unique.length) return out;

    try {
      const body = await this.rabbit.rpc<{ users?: MarketplaceUserContact[] }>(
        'user.rpc.marketplace.user.summaries',
        { userIds: unique },
      );
      for (const u of body.users ?? []) {
        if (u?.id) out.set(u.id, u);
      }
    } catch (e) {
      this.logger.warn(`user-summaries RPC error: ${String(e)}`);
    }
    return out;
  }
}
