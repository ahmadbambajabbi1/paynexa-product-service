import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CatalogListingVisibility,
  Prisma,
  ServiceBookingStatus,
  ServiceListingPriceType,
  ServiceProviderStatus,
} from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import {
  CreateServiceListingDto,
  ServiceListingPriceTypeDto,
} from './dto/create-service-listing.dto';
import { SearchServiceListingsDto } from './dto/search-service-listings.dto';
import { SetProviderStatusDto } from './dto/set-provider-status.dto';
import { UpdateServiceListingDto } from './dto/update-service-listing.dto';
import { UpsertProviderProfileDto } from './dto/upsert-provider-profile.dto';
import { PutServiceAvailabilityDto } from './dto/put-service-availability.dto';
import {
  CatalogListingVisibilityDto,
  ServiceListingCompleteMetadataDto,
} from './dto/service-listing-complete-metadata.dto';
import { CreateServiceReviewDto } from './dto/create-service-review.dto';
import type { UpdateMarketplaceFeePolicyDto } from './dto/update-marketplace-fee-policy.dto';
import {
  ServiceBookingActionDto,
  UpdateServiceBookingDto,
} from './dto/update-service-booking.dto';
import { resolveProductUploadMime, type MemoryUploadedFile } from '../products/product-image-mime.util';
import { R2UploadService } from '../products/r2-upload.service';
import {
  MarketplaceUserSummaryClient,
  type MarketplaceUserContact,
} from './marketplace-user-summary.client';
import {
  BookingRealtimeGateway,
  type BookingCommentSocketPayload,
} from './booking-realtime.gateway';

function parseMoney(value: string): Prisma.Decimal {
  const d = new Prisma.Decimal(value.trim());
  if (d.isNaN() || d.lt(0)) {
    throw new BadRequestException('invalid amount');
  }
  return d;
}

function toPriceType(
  dto?: ServiceListingPriceTypeDto,
): ServiceListingPriceType {
  return dto === ServiceListingPriceTypeDto.RANGE
    ? ServiceListingPriceType.RANGE
    : ServiceListingPriceType.FIXED;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ServiceMarketplaceService {
  private readonly renderingLocationLastPingMs = new Map<string, number>();

  private static readonly RENDERING_LOCATION_MIN_INTERVAL_MS = 120_000;
  /** Presence window: heartbeats older than this show OFFLINE; null lastSeen uses DB status. */
  private static readonly PROVIDER_ONLINE_WINDOW_MS = 600_000;
  private static readonly SYS_NOTE_PREFIX = '__sys__:';
  private static readonly COMMENT_NOTE_PREFIX = '__comment__:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2UploadService,
    private readonly marketplaceUsers: MarketplaceUserSummaryClient,
    private readonly bookingRealtime: BookingRealtimeGateway,
  ) {}

  private roundMoney2(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  async getPublicMarketplaceFeePolicy() {
    const row = await this.prisma.serviceMarketplaceFeePolicy.findUnique({
      where: { id: 'default' },
    });
    if (!row) {
      return {
        providerFeeEnabled: false,
        providerFeePercent: '0',
        customerFeeEnabled: false,
        customerFeePercent: '0',
      };
    }
    return {
      providerFeeEnabled: row.providerFeeEnabled,
      providerFeePercent: row.providerFeePercent.toString(),
      customerFeeEnabled: row.customerFeeEnabled,
      customerFeePercent: row.customerFeePercent.toString(),
    };
  }

  async updateMarketplaceFeePolicy(dto: UpdateMarketplaceFeePolicyDto) {
    const providerFeePercent = this.roundMoney2(
      new Prisma.Decimal(String(dto.providerFeePercent)),
    );
    const customerFeePercent = this.roundMoney2(
      new Prisma.Decimal(String(dto.customerFeePercent)),
    );
    if (providerFeePercent.lt(0) || providerFeePercent.gt(100)) {
      throw new BadRequestException('providerFeePercent must be 0–100');
    }
    if (customerFeePercent.lt(0) || customerFeePercent.gt(100)) {
      throw new BadRequestException('customerFeePercent must be 0–100');
    }
    const row = await this.prisma.serviceMarketplaceFeePolicy.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        providerFeeEnabled: dto.providerFeeEnabled,
        providerFeePercent,
        customerFeeEnabled: dto.customerFeeEnabled,
        customerFeePercent,
      },
      update: {
        providerFeeEnabled: dto.providerFeeEnabled,
        providerFeePercent,
        customerFeeEnabled: dto.customerFeeEnabled,
        customerFeePercent,
      },
    });
    return {
      providerFeeEnabled: row.providerFeeEnabled,
      providerFeePercent: row.providerFeePercent.toString(),
      customerFeeEnabled: row.customerFeeEnabled,
      customerFeePercent: row.customerFeePercent.toString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private computePlatformFeesFromPolicy(
    base: Prisma.Decimal,
    policy: {
      providerFeeEnabled: boolean;
      providerFeePercent: Prisma.Decimal;
      customerFeeEnabled: boolean;
      customerFeePercent: Prisma.Decimal;
    },
  ): { customerFee: Prisma.Decimal; providerFee: Prisma.Decimal } {
    let customerFee = new Prisma.Decimal(0);
    let providerFee = new Prisma.Decimal(0);
    if (policy.customerFeeEnabled && policy.customerFeePercent.gt(0)) {
      customerFee = this.roundMoney2(
        base.mul(policy.customerFeePercent).div(100),
      );
    }
    if (policy.providerFeeEnabled && policy.providerFeePercent.gt(0)) {
      providerFee = this.roundMoney2(
        base.mul(policy.providerFeePercent).div(100),
      );
    }
    return { customerFee, providerFee };
  }

  async getBookingPaymentBreakdownForInternal(bookingId: string) {
    const booking = await this.prisma.serviceBooking.findUnique({
      where: { id: bookingId.trim() },
      include: {
        listing: { include: { provider: true } },
      },
    });
    if (!booking) {
      throw new NotFoundException('booking not found');
    }
    const serviceAmount = booking.amount;
    const customerFee = booking.customerPlatformFeeAmount ?? new Prisma.Decimal(0);
    const providerFee = booking.providerPlatformFeeAmount ?? new Prisma.Decimal(0);
    const totalDebitFromCustomer = serviceAmount.add(customerFee);
    const netCreditToProvider = serviceAmount.sub(providerFee);
    const platformFeeTotal = customerFee.add(providerFee);
    if (netCreditToProvider.lte(0)) {
      throw new BadRequestException(
        'booking payout would be non-positive; adjust fee settings or agreed amount',
      );
    }
    return {
      payerUserId: booking.clientUserId,
      providerUserId: booking.listing.provider.userId,
      serviceAmount: serviceAmount.toString(),
      customerPlatformFeeAmount: customerFee.toString(),
      providerPlatformFeeAmount: providerFee.toString(),
      totalDebitFromCustomer: totalDebitFromCustomer.toString(),
      netCreditToProvider: netCreditToProvider.toString(),
      platformFeeTotal: platformFeeTotal.toString(),
      currency: booking.currency,
    };
  }

  /** Contact fields (name, phone, email) for the other party on an active booking — loaded from user-service. */
  private async recomputeProviderRatingAggregates(providerId: string): Promise<void> {
    const agg = await this.prisma.serviceReview.aggregate({
      where: { providerId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await this.prisma.serviceProvider.update({
      where: { id: providerId },
      data: {
        ratingAvg: agg._avg.rating ?? 0,
        ratingCount: agg._count._all,
      },
    });
  }

  async submitBookingReview(
    userId: string,
    bookingId: string,
    dto: CreateServiceReviewDto,
  ) {
    const booking = await this.prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        listing: true,
        provider: true,
        review: true,
      },
    });
    if (!booking) throw new BadRequestException('booking not found');
    if (booking.clientUserId !== userId) throw new ForbiddenException();
    if (booking.review) {
      throw new BadRequestException('this booking already has a review');
    }
    const flags = this.extractSystemFlags(booking.notes ?? null);
    const workFinishedByProvider = flags.has('provider_finished');
    const allowedStatuses: ServiceBookingStatus[] = [
      ServiceBookingStatus.COMPLETED,
      ServiceBookingStatus.PENDING_PAYMENT,
      ServiceBookingStatus.FUNDED,
    ];
    if (
      !workFinishedByProvider ||
      !allowedStatuses.includes(booking.status)
    ) {
      throw new BadRequestException(
        'you can review after the provider has marked the service completed',
      );
    }
    const rating = Math.round(Number(dto.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('rating must be between 1 and 5');
    }
    const comment = dto.comment?.trim();
    const created = await this.prisma.serviceReview.create({
      data: {
        bookingId: booking.id,
        listingId: booking.listingId,
        providerId: booking.providerId,
        clientUserId: userId,
        rating,
        comment: comment && comment.length > 0 ? comment : null,
      },
    });
    await this.recomputeProviderRatingAggregates(booking.providerId);
    return { review: created };
  }

  private async participantSummariesForBookingViewer(
    viewerUserId: string | undefined,
    clientUserId: string,
    providerUserId: string,
  ): Promise<{
    summaries: Map<string, MarketplaceUserContact>;
    participantContact?: {
      client?: MarketplaceUserContact;
      provider?: MarketplaceUserContact;
    };
  }> {
    const empty = new Map<string, MarketplaceUserContact>();
    if (
      !viewerUserId ||
      (viewerUserId !== clientUserId && viewerUserId !== providerUserId)
    ) {
      return { summaries: empty };
    }
    const summaries = await this.marketplaceUsers.fetchSummaries([
      clientUserId,
      providerUserId,
    ]);
    return {
      summaries,
      participantContact: {
        client: summaries.get(clientUserId),
        provider: summaries.get(providerUserId),
      },
    };
  }

  /** Avoid treating opaque user ids / cuids stored as display_name as a human label. */
  private isProbablyOpaqueUserId(value: string, userId: string): boolean {
    const v = value.trim();
    if (!v) return true;
    if (userId && v === userId) return true;
    if (/^c[a-z0-9]{24,}$/i.test(v)) return true;
    if (/^[0-9a-f-]{36}$/i.test(v)) return true;
    return false;
  }

  private resolveProviderDisplayName(
    provider: Record<string, unknown>,
    summary?: MarketplaceUserContact | null,
  ): string | null {
    const fromSummary =
      (summary?.displayName?.trim() || summary?.fullName?.trim() || '').trim() ||
      null;
    if (fromSummary) return fromSummary;
    const userId = String(provider.userId ?? '');
    const db =
      typeof provider.displayName === 'string' ? provider.displayName.trim() : '';
    if (db && !this.isProbablyOpaqueUserId(db, userId)) return db;
    return null;
  }

  private mergeListingProviderIdentityFromSummaries<
    T extends { provider: Record<string, unknown> },
  >(listing: T, summaries: Map<string, MarketplaceUserContact>): T {
    const uid = String(listing.provider.userId ?? '');
    const summary = uid ? summaries.get(uid) : undefined;
    const displayName = this.resolveProviderDisplayName(
      listing.provider,
      summary ?? null,
    );
    return {
      ...listing,
      provider: {
        ...listing.provider,
        displayName: displayName ?? listing.provider.displayName ?? null,
      },
    };
  }

  private effectiveProviderStatus(
    status: ServiceProviderStatus | string,
    lastSeenAt: Date | string | null | undefined,
  ): ServiceProviderStatus {
    const stored =
      status === ServiceProviderStatus.AWAY
        ? ServiceProviderStatus.AWAY
        : status === ServiceProviderStatus.ONLINE
          ? ServiceProviderStatus.ONLINE
          : ServiceProviderStatus.OFFLINE;
    if (!lastSeenAt) {
      return stored;
    }
    const t = new Date(lastSeenAt).getTime();
    if (!Number.isFinite(t)) {
      return stored;
    }
    if (Date.now() - t > ServiceMarketplaceService.PROVIDER_ONLINE_WINDOW_MS) {
      return stored;
    }
    if (stored === ServiceProviderStatus.AWAY) return ServiceProviderStatus.AWAY;
    return ServiceProviderStatus.ONLINE;
  }

  private withComputedProviderStatus<T extends { provider?: Record<string, unknown> }>(
    listing: T,
  ): T {
    if (!listing.provider) return listing;
    const effective = this.effectiveProviderStatus(
      String(listing.provider.status ?? ServiceProviderStatus.OFFLINE),
      (listing.provider.lastSeenAt as Date | string | null | undefined) ?? null,
    );
    return {
      ...listing,
      provider: {
        ...listing.provider,
        status: effective,
      },
    };
  }

  private extractSystemFlags(notes: string | null | undefined): Set<string> {
    const out = new Set<string>();
    if (!notes) return out;
    for (const line of notes.split('\n')) {
      const t = line.trim();
      if (t.startsWith(ServiceMarketplaceService.SYS_NOTE_PREFIX)) {
        out.add(t.slice(ServiceMarketplaceService.SYS_NOTE_PREFIX.length).trim());
      }
    }
    return out;
  }

  private stripSystemNotes(notes: string | null | undefined): string | null {
    if (!notes) return null;
    const lines = notes
      .split('\n')
      .map((x) => x.trimEnd())
      .filter(
        (x) =>
          x.trim() &&
          !x.trim().startsWith(ServiceMarketplaceService.SYS_NOTE_PREFIX) &&
          !x.trim().startsWith(ServiceMarketplaceService.COMMENT_NOTE_PREFIX),
      );
    return lines.length ? lines.join('\n') : null;
  }

  private encodeCommentText(text: string): string {
    return Buffer.from(text, 'utf8').toString('base64');
  }

  private decodeCommentText(raw: string): string {
    try {
      return Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  private parseBookingCommentLine(line: string): {
    createdAt: string;
    authorUserId: string;
    message: string;
  } | null {
    const t = line.trim();
    if (!t.startsWith(ServiceMarketplaceService.COMMENT_NOTE_PREFIX)) return null;
    const rest = t.slice(ServiceMarketplaceService.COMMENT_NOTE_PREFIX.length);
    /** Newer lines use unit separator (ISO timestamps contain `:`) */
    const us = '\x1f';
    if (rest.includes(us)) {
      const [createdAt, authorUserId, payload] = rest.split(us, 3);
      if (!createdAt?.trim() || !authorUserId?.trim() || !payload?.trim()) return null;
      const message = this.decodeCommentText(payload.trim()).trim();
      if (!message) return null;
      return {
        createdAt: createdAt.trim(),
        authorUserId: authorUserId.trim(),
        message,
      };
    }
    /** Legacy colon format: `{iso}:{userId}:{base64}` — split payload/userId off the tail */
    const segs = rest.split(':').filter(Boolean);
    if (segs.length < 3) return null;
    const payload = segs[segs.length - 1]!.trim();
    const authorUserId = segs[segs.length - 2]!.trim();
    const createdAt = segs.slice(0, segs.length - 2).join(':').trim();
    if (!createdAt || !authorUserId || !payload) return null;
    const message = this.decodeCommentText(payload).trim();
    if (!message) return null;
    return { createdAt, authorUserId, message };
  }

  private extractBookingComments(notes: string | null | undefined): Array<{
    createdAt: string;
    authorUserId: string;
    message: string;
  }> {
    if (!notes) return [];
    const out: Array<{ createdAt: string; authorUserId: string; message: string }> = [];
    for (const line of notes.split('\n')) {
      const parsed = this.parseBookingCommentLine(line);
      if (parsed) out.push(parsed);
    }
    out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return out;
  }

  private appendBookingComment(
    notes: string | null | undefined,
    authorUserId: string,
    message: string,
  ): string {
    const userNotes = this.stripSystemNotes(notes);
    const flags = Array.from(this.extractSystemFlags(notes))
      .sort()
      .map((f) => `${ServiceMarketplaceService.SYS_NOTE_PREFIX}${f}`);
    const sep = '\x1f';
    const comments = this.extractBookingComments(notes).map((c) => {
      const encoded = this.encodeCommentText(c.message);
      return `${ServiceMarketplaceService.COMMENT_NOTE_PREFIX}${c.createdAt}${sep}${c.authorUserId}${sep}${encoded}`;
    });
    const now = new Date().toISOString();
    const encodedMessage = this.encodeCommentText(message);
    const newLine = `${ServiceMarketplaceService.COMMENT_NOTE_PREFIX}${now}${sep}${authorUserId}${sep}${encodedMessage}`;
    return [userNotes, ...comments, newLine, ...flags].filter(Boolean).join('\n');
  }

  private appendSystemFlag(notes: string | null | undefined, flag: string): string {
    const flags = this.extractSystemFlags(notes);
    flags.add(flag);
    const user = this.stripSystemNotes(notes);
    const sys = Array.from(flags)
      .sort()
      .map((f) => `${ServiceMarketplaceService.SYS_NOTE_PREFIX}${f}`);
    return [user, ...sys].filter(Boolean).join('\n');
  }

  async listCategories() {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { categories };
  }

  async createCategory(dto: CreateServiceCategoryDto) {
    const category = await this.prisma.serviceCategory.create({
      data: {
        code: dto.code.trim(),
        name: dto.name.trim(),
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return { category };
  }

  async upsertMyProviderProfile(userId: string, dto: UpsertProviderProfileDto) {
    const provider = await this.prisma.serviceProvider.upsert({
      where: { userId },
      update: {
        displayName: dto.displayName?.trim(),
        bio: dto.bio,
        lastSeenAt: new Date(),
        location:
          dto.latitude != null && dto.longitude != null
            ? {
                upsert: {
                  create: {
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    addressText: dto.addressText?.trim(),
                    region: dto.region?.trim(),
                  },
                  update: {
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    addressText: dto.addressText?.trim(),
                    region: dto.region?.trim(),
                  },
                },
              }
            : undefined,
      },
      create: {
        userId,
        displayName: dto.displayName?.trim(),
        bio: dto.bio,
        lastSeenAt: new Date(),
        status: ServiceProviderStatus.OFFLINE,
        location:
          dto.latitude != null && dto.longitude != null
            ? {
                create: {
                  latitude: dto.latitude,
                  longitude: dto.longitude,
                  addressText: dto.addressText?.trim(),
                  region: dto.region?.trim(),
                },
              }
            : undefined,
      },
      include: { location: true },
    });
    return { provider };
  }

  async setMyProviderStatus(userId: string, dto: SetProviderStatusDto) {
    const provider = await this.prisma.serviceProvider.upsert({
      where: { userId },
      update: {
        status: dto.status as ServiceProviderStatus,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        status: dto.status as ServiceProviderStatus,
        lastSeenAt: new Date(),
      },
    });
    return { provider };
  }

  async pingMyProvider(userId: string) {
    const provider = await this.prisma.serviceProvider.upsert({
      where: { userId },
      update: { lastSeenAt: new Date(), status: ServiceProviderStatus.ONLINE },
      create: {
        userId,
        status: ServiceProviderStatus.ONLINE,
        lastSeenAt: new Date(),
      },
    });
    return { provider };
  }

  /**
   * Throttled provider GPS ping for “services rendering location” (distance ranking).
   * Avoids hammering Prisma/R2 when apps poll location.
   */
  async pingRenderingLocation(
    userId: string,
    latitude: number,
    longitude: number,
    locationLabel?: string,
  ) {
    const now = Date.now();
    const last = this.renderingLocationLastPingMs.get(userId) ?? 0;
    if (now - last < ServiceMarketplaceService.RENDERING_LOCATION_MIN_INTERVAL_MS) {
      return { ok: true as const, skipped: true as const };
    }
    const existingProvider = await this.prisma.serviceProvider.findUnique({
      where: { userId },
    });
    /** Only sellers with a marketplace profile refresh location/status here (not every logged-in shopper). */
    if (!existingProvider) {
      return { ok: true as const, skipped: true as const };
    }
    this.renderingLocationLastPingMs.set(userId, now);
    const provider = existingProvider;
    const label = locationLabel?.trim();
    const locData: { latitude: number; longitude: number; addressText?: string } = {
      latitude,
      longitude,
    };
    if (label && label.length >= 3) {
      locData.addressText = label.slice(0, 500);
    }
    await this.prisma.serviceProvider.update({
      where: { id: provider.id },
      data: {
        lastSeenAt: new Date(),
        status: ServiceProviderStatus.ONLINE,
        location: {
          upsert: {
            create: locData,
            update: locData,
          },
        },
      },
      include: { location: true },
    });
    return { ok: true as const, skipped: false as const };
  }

  private async requireProvider(userId: string) {
    let provider = await this.prisma.serviceProvider.findUnique({
      where: { userId },
    });
    if (!provider) {
      provider = await this.prisma.serviceProvider.create({
        data: {
          userId,
          status: ServiceProviderStatus.OFFLINE,
          lastSeenAt: new Date(),
        },
      });
    }
    const needsDisplay =
      !provider.displayName?.trim() || provider.displayName.trim().length === 0;
    if (needsDisplay) {
      const map = await this.marketplaceUsers.fetchSummaries([userId]);
      const u = map.get(userId);
      const dn =
        u?.displayName?.trim() ||
        u?.fullName?.trim() ||
        provider.displayName?.trim();
      if (dn && dn.length > 0) {
        provider = await this.prisma.serviceProvider.update({
          where: { id: provider.id },
          data: { displayName: dn },
        });
      }
    }
    return provider;
  }

  async createListing(userId: string, dto: CreateServiceListingDto) {
    const provider = await this.requireProvider(userId);

    const priceType = toPriceType(dto.priceType);
    const data: Prisma.ServiceListingCreateInput = {
      provider: { connect: { id: provider.id } },
      category: { connect: { id: dto.categoryId } },
      title: dto.title.trim(),
      description: dto.description.trim(),
      tags: toJson(dto.tags ?? []),
      media: toJson(dto.media ?? []),
      priceType,
      estimatedDeliveryMins: dto.estimatedDeliveryMins,
      active: true,
      visibility: CatalogListingVisibility.PUBLISHED,
    };

    if (priceType === ServiceListingPriceType.FIXED) {
      data.priceAmount = parseMoney(dto.priceAmount);
    } else {
      const min = parseMoney(dto.priceMin);
      const max = parseMoney(dto.priceMax);
      if (max.lt(min)) {
        throw new BadRequestException('priceMax must be >= priceMin');
      }
      data.priceMin = min;
      data.priceMax = max;
    }

    const listing = await this.prisma.serviceListing.create({
      data,
      include: { provider: { include: { location: true } }, category: true },
    });
    return { listing };
  }

  async updateListing(
    userId: string,
    listingId: string,
    dto: UpdateServiceListingDto,
  ) {
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id: listingId },
      include: { provider: true },
    });
    if (!listing) {
      throw new BadRequestException('listing not found');
    }
    if (listing.provider.userId !== userId) {
      throw new ForbiddenException();
    }

    const priceType =
      dto.priceType != null ? toPriceType(dto.priceType) : listing.priceType;

    const data: Prisma.ServiceListingUpdateInput = {
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      category: dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : undefined,
      tags: dto.tags ? toJson(dto.tags) : undefined,
      media: dto.media ? toJson(dto.media) : undefined,
      estimatedDeliveryMins: dto.estimatedDeliveryMins,
      active: dto.active,
      priceType,
      visibility:
        dto.visibility === CatalogListingVisibilityDto.DRAFT
          ? CatalogListingVisibility.DRAFT
          : dto.visibility === CatalogListingVisibilityDto.PUBLISHED
            ? CatalogListingVisibility.PUBLISHED
            : undefined,
    };

    if (
      dto.priceType != null ||
      dto.priceAmount != null ||
      dto.priceMin != null ||
      dto.priceMax != null
    ) {
      if (priceType === ServiceListingPriceType.FIXED) {
        if (!dto.priceAmount)
          throw new BadRequestException('priceAmount required for FIXED');
        data.priceAmount = parseMoney(dto.priceAmount);
        data.priceMin = null;
        data.priceMax = null;
      } else {
        if (!dto.priceMin || !dto.priceMax)
          throw new BadRequestException(
            'priceMin and priceMax required for RANGE',
          );
        const min = parseMoney(dto.priceMin);
        const max = parseMoney(dto.priceMax);
        if (max.lt(min))
          throw new BadRequestException('priceMax must be >= priceMin');
        data.priceAmount = null;
        data.priceMin = min;
        data.priceMax = max;
      }
    }

    const updated = await this.prisma.serviceListing.update({
      where: { id: listingId },
      data,
      include: { provider: { include: { location: true } }, category: true },
    });

    const map = await this.marketplaceUsers.fetchSummaries([userId]);
    return {
      listing: this.mergeListingProviderIdentityFromSummaries(
        this.withComputedProviderStatus(updated),
        map,
      ),
    };
  }

  async getListing(id: string, viewerUserId?: string) {
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id },
      include: {
        provider: { include: { location: true } },
        category: true,
        reviews: { orderBy: { createdAt: 'desc' }, take: 10 },
        availability: {
          orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
        },
      },
    });
    if (!listing) throw new BadRequestException('listing not found');
    if (
      listing.visibility === CatalogListingVisibility.DRAFT &&
      !(viewerUserId != null && listing.provider.userId === viewerUserId)
    ) {
      throw new NotFoundException('listing not found');
    }
    const providerUserId = listing.provider.userId;
    const providerSummaryMap = await this.marketplaceUsers.fetchSummaries([providerUserId]);
    const providerSummary = providerSummaryMap.get(providerUserId);
    const providerDisplayName = this.resolveProviderDisplayName(
      listing.provider as Record<string, unknown>,
      providerSummary ?? null,
    );
    const expanded = this.withComputedProviderStatus({
      ...listing,
      provider: {
        ...listing.provider,
        displayName: providerDisplayName ?? null,
      },
      coverImage: await this.r2.expandImageRefsForResponse(listing.coverImage),
      serviceImages: await this.r2.expandImageRefsForResponse(listing.serviceImages),
    });
    const viewerIsOwner =
      viewerUserId != null && listing.provider.userId === viewerUserId;
    /** Identity rows from user-service when configured; phone/email only for signed-in viewers. */
    let providerContact: MarketplaceUserContact | null = null;
    if (providerSummary) {
      providerContact =
        viewerUserId != null
          ? providerSummary
          : {
              ...providerSummary,
              email: null,
              phone: null,
              countryCode: null,
            };
    }
    return { listing: expanded, viewerIsOwner, providerContact };
  }

  async listMyListings(userId: string) {
    const provider = await this.prisma.serviceProvider.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!provider) return { listings: [] as unknown[] };
    const listings = await this.prisma.serviceListing.findMany({
      where: { providerId: provider.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        category: true,
        provider: { include: { location: true } },
      },
    });
    const ownerSummaries = await this.marketplaceUsers.fetchSummaries([userId]);
    const expanded = await Promise.all(
      listings.map(async (l) => ({
        ...this.mergeListingProviderIdentityFromSummaries(
          this.withComputedProviderStatus(l),
          ownerSummaries,
        ),
        coverImage: await this.r2.expandImageRefsForResponse(l.coverImage),
        serviceImages: await this.r2.expandImageRefsForResponse(l.serviceImages),
      })),
    );
    return { listings: expanded };
  }

  async createListingComplete(
    userId: string,
    meta: ServiceListingCompleteMetadataDto,
    cover: MemoryUploadedFile,
    gallery: MemoryUploadedFile[],
  ) {
    const provider = await this.requireProvider(userId);

    const ctCover = resolveProductUploadMime(cover);
    if (!ctCover) {
      throw new BadRequestException('Cover: unsupported or missing image type');
    }
    const { key: coverKey } = await this.r2.uploadServiceCover({
      userId,
      buffer: cover.buffer,
      contentType: ctCover,
      originalName: cover.originalname,
    });

    const galleryKeys: string[] = [];
    try {
      for (const g of gallery) {
        if (!g?.buffer?.length) continue;
        const ct = resolveProductUploadMime(g);
        if (!ct) {
          throw new BadRequestException(
            'Gallery: unsupported or missing image type',
          );
        }
        const { key } = await this.r2.uploadServiceImage({
          userId,
          buffer: g.buffer,
          contentType: ct,
          originalName: g.originalname,
        });
        galleryKeys.push(key);
      }
      if (galleryKeys.length < 1) {
        throw new BadRequestException('At least one gallery image is required');
      }

      const priceType = toPriceType(meta.priceType);
      const visibility =
        meta.visibility === CatalogListingVisibilityDto.DRAFT
          ? CatalogListingVisibility.DRAFT
          : CatalogListingVisibility.PUBLISHED;
      const data: Prisma.ServiceListingCreateInput = {
        provider: { connect: { id: provider.id } },
        category: { connect: { id: meta.categoryId } },
        title: meta.title.trim(),
        description: meta.description.trim(),
        coverImage: coverKey,
        serviceImages: toJson(galleryKeys),
        tags: toJson([]),
        media: toJson([]),
        priceType,
        estimatedDeliveryMins: meta.estimatedDeliveryMins,
        active: true,
        visibility,
      };

      if (priceType === ServiceListingPriceType.FIXED) {
        if (meta.priceAmount == null) {
          throw new BadRequestException('priceAmount required for FIXED');
        }
        data.priceAmount = parseMoney(String(meta.priceAmount));
      } else {
        if (meta.priceMin == null || meta.priceMax == null) {
          throw new BadRequestException('priceMin and priceMax required for RANGE');
        }
        const min = parseMoney(String(meta.priceMin));
        const max = parseMoney(String(meta.priceMax));
        if (max.lt(min)) {
          throw new BadRequestException('priceMax must be >= priceMin');
        }
        data.priceMin = min;
        data.priceMax = max;
      }

      const listing = await this.prisma.serviceListing.create({
        data,
        include: { provider: { include: { location: true } }, category: true },
      });

      if (
        typeof meta.latitude === 'number' &&
        typeof meta.longitude === 'number'
      ) {
        await this.prisma.serviceProvider.update({
          where: { id: provider.id },
          data: {
            location: {
              upsert: {
                create: {
                  latitude: meta.latitude,
                  longitude: meta.longitude,
                },
                update: {
                  latitude: meta.latitude,
                  longitude: meta.longitude,
                },
              },
            },
          },
        });
      }

      return {
        listing: this.withComputedProviderStatus({
          ...listing,
          coverImage: await this.r2.expandImageRefsForResponse(listing.coverImage),
          serviceImages: await this.r2.expandImageRefsForResponse(listing.serviceImages),
        }),
      };
    } catch (e) {
      await this.r2.deleteServiceKeysForUser(userId, [coverKey, ...galleryKeys]);
      throw e;
    }
  }

  async putListingAvailability(
    userId: string,
    listingId: string,
    dto: PutServiceAvailabilityDto,
  ) {
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id: listingId },
      include: { provider: true },
    });
    if (!listing) throw new BadRequestException('listing not found');
    if (listing.provider.userId !== userId) throw new ForbiddenException();

    const slots = dto.slots ?? [];
    for (const s of slots) {
      if (s.endMinute <= s.startMinute) {
        throw new BadRequestException('endMinute must be > startMinute');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.serviceAvailability.deleteMany({ where: { listingId } });
      if (slots.length) {
        await tx.serviceAvailability.createMany({
          data: slots.map((s) => ({
            listingId,
            dayOfWeek: s.dayOfWeek,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
            timezone: s.timezone?.trim() || 'Africa/Banjul',
          })),
        });
      }
    });

    const availability = await this.prisma.serviceAvailability.findMany({
      where: { listingId },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
    return { listingId, availability };
  }

  async searchListings(query: SearchServiceListingsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const offset = (page - 1) * pageSize;

    const lat = query.latitude;
    const lng = query.longitude;

    const availableAt = query.availableAt
      ? new Date(query.availableAt)
      : undefined;
    const onlineOnly = query.onlineOnly ?? false;

    if ((lat == null) !== (lng == null)) {
      throw new BadRequestException(
        'latitude and longitude must be provided together',
      );
    }

    // If no geo is provided, we still return results (sorted by status/rating/response/verification),
    // but distance-based ranking can’t apply.
    const useGeo = lat != null && lng != null;

    // Availability filter uses provider's configured schedule on the listing.
    let dow: number | null = null;
    let minuteOfDay: number | null = null;
    if (availableAt) {
      // Africa/Banjul is UTC; we treat Date as UTC for MVP.
      dow = availableAt.getUTCDay();
      minuteOfDay =
        availableAt.getUTCHours() * 60 + availableAt.getUTCMinutes();
    }

    const categoryId = query.categoryId?.trim() || null;
    const categoryCode = query.categoryCode?.trim() || null;
    const minPrice = query.minPrice ?? null;
    const maxPrice = query.maxPrice ?? null;

    const rows = await this.prisma.$queryRaw<
      Array<{
        listing_id: string;
        distance_km: number | null;
        rating_avg: number;
        rank_score: number;
      }>
    >(Prisma.sql`
      WITH base AS (
        SELECT
          l.id AS listing_id,
          CASE
            WHEN p.last_seen_at IS NULL THEN p.status
            WHEN p.last_seen_at < NOW() - interval '10 minutes' THEN p.status
            WHEN p.status = 'AWAY'::"ServiceProviderStatus" THEN 'AWAY'::"ServiceProviderStatus"
            ELSE 'ONLINE'::"ServiceProviderStatus"
          END AS provider_status,
          p.rating_avg AS rating_avg,
          p.avg_response_time_sec AS response_time_sec,
          p.verification_status AS verification_status,
          loc.latitude AS provider_lat,
          loc.longitude AS provider_lng,
          CASE
            WHEN ${useGeo} THEN (
              6371 * acos(
                cos(radians(${lat ?? 0})) * cos(radians(loc.latitude)) *
                cos(radians(loc.longitude) - radians(${lng ?? 0})) +
                sin(radians(${lat ?? 0})) * sin(radians(loc.latitude))
              )
            )
            ELSE NULL
          END AS distance_km,
          CASE
            WHEN ${availableAt != null} THEN EXISTS (
              SELECT 1
              FROM "ServiceAvailability" a
              WHERE a.listing_id = l.id
                AND a.day_of_week = ${dow}
                AND a.start_minute <= ${minuteOfDay}
                AND a.end_minute > ${minuteOfDay}
            )
            ELSE true
          END AS availability_match
        FROM "ServiceListing" l
        JOIN "ServiceProvider" p ON p.id = l.provider_id
        LEFT JOIN "ServiceLocation" loc ON loc.provider_id = p.id
        JOIN "ServiceCategory" c ON c.id = l.category_id
        WHERE l.active = true
          AND l.visibility = 'PUBLISHED'::"CatalogListingVisibility"
          AND c.active = true
          AND (${categoryId}::text IS NULL OR l.category_id = ${categoryId}::text)
          AND (${categoryCode}::text IS NULL OR c.code = ${categoryCode}::text)
          AND (
            ${onlineOnly}::boolean = false
            OR (
              CASE
                WHEN p.last_seen_at IS NULL THEN p.status
                WHEN p.last_seen_at < NOW() - interval '10 minutes' THEN p.status
                WHEN p.status = 'AWAY'::"ServiceProviderStatus" THEN 'AWAY'::"ServiceProviderStatus"
                ELSE 'ONLINE'::"ServiceProviderStatus"
              END = 'ONLINE'::"ServiceProviderStatus"
            )
          )
          AND (
            ${minPrice}::double precision IS NULL
            OR COALESCE(l.price_amount::double precision, l.price_min::double precision, 0) >= ${minPrice}::double precision
          )
          AND (
            ${maxPrice}::double precision IS NULL
            OR COALESCE(l.price_amount::double precision, l.price_max::double precision, l.price_min::double precision, 0) <= ${maxPrice}::double precision
          )
      ),
      filtered AS (
        SELECT *
        FROM base
        WHERE availability_match = true
      )
      SELECT
        listing_id,
        distance_km,
        rating_avg,
        (
          -- Online status weight dominates (online > away > offline)
          (CASE provider_status WHEN 'ONLINE' THEN 1000 WHEN 'AWAY' THEN 600 ELSE 0 END)
          -- Distance penalty (offline close should still lose to online reasonable distance)
          + (CASE WHEN distance_km IS NULL THEN 0 ELSE (-(distance_km * 10)) END)
          -- Rating boost
          + (rating_avg * 50)
          -- Response time penalty
          + (CASE WHEN response_time_sec IS NULL THEN 0 ELSE (-(LEAST(response_time_sec, 7200) / 60.0) * 5) END)
          -- Verified boost
          + (CASE WHEN verification_status = 'verified' THEN 80 ELSE 0 END)
          -- Availability match boost already filtered; keep slight preference
          + 20
        ) AS rank_score
      FROM filtered
      ORDER BY
        (CASE WHEN distance_km IS NULL THEN 1 ELSE 0 END) ASC,
        distance_km ASC NULLS LAST,
        rating_avg DESC NULLS LAST,
        rank_score DESC,
        listing_id ASC
      OFFSET ${offset}
      LIMIT ${pageSize}
    `);

    const ids = rows.map((r) => r.listing_id);
    const listings = ids.length
      ? await this.prisma.serviceListing.findMany({
          where: { id: { in: ids } },
          include: {
            provider: { include: { location: true } },
            category: true,
          },
        })
      : [];

    const byId = new Map(listings.map((l) => [l.id, l]));
    const providerUserIds = Array.from(
      new Set(listings.map((l) => String(l.provider.userId ?? '')).filter(Boolean)),
    );
    const providerSummaryByUserId = providerUserIds.length
      ? await this.marketplaceUsers.fetchSummaries(providerUserIds)
      : new Map<string, MarketplaceUserContact>();
    const items = await Promise.all(
      rows.map(async (r) => {
        const listing = byId.get(r.listing_id);
        if (!listing) return null;
        const summary = providerSummaryByUserId.get(String(listing.provider.userId ?? ''));
        const providerDisplayName = this.resolveProviderDisplayName(
          listing.provider as Record<string, unknown>,
          summary ?? null,
        );
        const expanded = {
          ...this.withComputedProviderStatus({
            ...listing,
            provider: {
              ...listing.provider,
              displayName: providerDisplayName ?? null,
            },
          }),
          coverImage: await this.r2.expandImageRefsForResponse(listing.coverImage),
          serviceImages: await this.r2.expandImageRefsForResponse(listing.serviceImages),
        };
        return { listing: expanded, distanceKm: r.distance_km, rankScore: r.rank_score };
      }),
    );
    return {
      page,
      pageSize,
      items: items.filter((x): x is NonNullable<typeof x> => Boolean(x)),
    };
  }

  async createBooking(
    userId: string,
    listingId: string,
    body: {
      scheduledAt?: Date;
      agreedAmount?: number;
      notes?: string;
      serviceLatitude?: number;
      serviceLongitude?: number;
      serviceAddressText?: string;
      serviceLocationLabel?: string;
      serviceGooglePlaceId?: string;
    },
  ) {
    const {
      scheduledAt,
      agreedAmount,
      notes,
      serviceLatitude,
      serviceLongitude,
      serviceAddressText,
      serviceLocationLabel,
      serviceGooglePlaceId,
    } = body;
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id: listingId },
      include: { provider: true },
    });
    if (!listing || !listing.active)
      throw new BadRequestException('listing not found');
    if (listing.visibility !== CatalogListingVisibility.PUBLISHED) {
      throw new BadRequestException('listing is not published');
    }
    if (listing.provider.userId === userId) {
      throw new BadRequestException('You cannot book your own service');
    }

    let amount: Prisma.Decimal | null = null;
    if (listing.priceType === ServiceListingPriceType.FIXED) {
      amount = listing.priceAmount ?? null;
      if (!amount) throw new BadRequestException('listing has no fixed price');
    } else {
      if (agreedAmount == null || !Number.isFinite(agreedAmount) || agreedAmount <= 0) {
        throw new BadRequestException('agreedAmount is required for range pricing');
      }
      const agreed = new Prisma.Decimal(String(agreedAmount));
      const min = listing.priceMin;
      const max = listing.priceMax;
      if (min && agreed.lt(min)) {
        throw new BadRequestException(`agreedAmount must be >= ${min.toString()}`);
      }
      if (max && agreed.gt(max)) {
        throw new BadRequestException(`agreedAmount must be <= ${max.toString()}`);
      }
      amount = agreed;
    }

    const policyRow = await this.prisma.serviceMarketplaceFeePolicy.findUnique({
      where: { id: 'default' },
    });
    const policy = policyRow ?? {
      providerFeeEnabled: false,
      providerFeePercent: new Prisma.Decimal(0),
      customerFeeEnabled: false,
      customerFeePercent: new Prisma.Decimal(0),
    };
    const { customerFee, providerFee } = this.computePlatformFeesFromPolicy(
      amount,
      policy,
    );
    const providerNet = amount.sub(providerFee);
    if (providerNet.lte(0)) {
      throw new BadRequestException(
        'platform fee leaves no payout for the provider; contact support',
      );
    }

    const coordsOk =
      serviceLatitude !== undefined &&
      serviceLongitude !== undefined &&
      Number.isFinite(serviceLatitude) &&
      Number.isFinite(serviceLongitude);
    const supplementary = serviceAddressText?.trim() ?? '';
    const pickedLabel =
      typeof serviceLocationLabel === 'string' ? serviceLocationLabel.trim() : '';
    const primaryLabel =
      pickedLabel.length >= 8
        ? pickedLabel
        : supplementary.length >= 8
          ? supplementary
          : '';
    if (!primaryLabel) {
      throw new BadRequestException(
        'Pick a readable service location (search or GPS with address). Add access notes separately if needed.',
      );
    }
    const addressNotesOnly =
      supplementary.length > 0 && supplementary !== primaryLabel ? supplementary : null;

    const booking = await this.prisma.serviceBooking.create({
      data: {
        listingId: listing.id,
        providerId: listing.providerId,
        clientUserId: userId,
        scheduledAt: scheduledAt ?? new Date(),
        serviceLatitude:
          coordsOk && typeof serviceLatitude === 'number'
            ? serviceLatitude
            : null,
        serviceLongitude:
          coordsOk && typeof serviceLongitude === 'number'
            ? serviceLongitude
            : null,
        serviceLocationLabel: primaryLabel,
        serviceGooglePlaceId: serviceGooglePlaceId?.trim() || null,
        serviceAddressText: addressNotesOnly,
        status: ServiceBookingStatus.PENDING_PAYMENT,
        amount,
        customerPlatformFeeAmount: customerFee,
        providerPlatformFeeAmount: providerFee,
        notes,
      },
      include: {
        listing: {
          include: {
            provider: { include: { location: true } },
            category: true,
          },
        },
        review: true,
      },
    });

    // Bookings are NOT transaction-service transactions.
    // Payment + escrow funding will be handled via wallet/card flows tied to this booking.
    return {
      booking: await this.expandBookingForResponse(booking, userId),
    };
  }

  async listBookingsForListingOwner(userId: string, listingId: string) {
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id: listingId },
      include: { provider: true },
    });
    if (!listing) throw new BadRequestException('listing not found');
    if (listing.provider.userId !== userId) throw new ForbiddenException();
    const items = await this.prisma.serviceBooking.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        listing: {
          include: { category: true, provider: { include: { location: true } } },
        },
        provider: true,
        review: true,
      },
    });
    const expanded = await Promise.all(
      items.map((b) => this.expandBookingForResponse(b, userId)),
    );
    return { bookings: expanded };
  }

  async listBookingsForClient(userId: string) {
    const items = await this.prisma.serviceBooking.findMany({
      where: { clientUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        listing: {
          include: { category: true, provider: { include: { location: true } } },
        },
        review: true,
      },
    });
    const expanded = await Promise.all(
      items.map((b) => this.expandBookingForResponse(b, userId)),
    );
    return { bookings: expanded };
  }

  async listBookingsForProviderUser(userId: string) {
    const provider = await this.prisma.serviceProvider.findUnique({ where: { userId } });
    if (!provider) return { bookings: [] };
    const items = await this.prisma.serviceBooking.findMany({
      where: { providerId: provider.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        listing: {
          include: { category: true, provider: { include: { location: true } } },
        },
        review: true,
      },
    });
    const expanded = await Promise.all(
      items.map((b) => this.expandBookingForResponse(b, userId)),
    );
    return { bookings: expanded };
  }

  async publishMyServiceListing(userId: string, listingId: string) {
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id: listingId },
      include: { provider: true, category: true },
    });
    if (!listing) throw new BadRequestException('listing not found');
    if (listing.provider.userId !== userId) throw new ForbiddenException();
    const updated = await this.prisma.serviceListing.update({
      where: { id: listingId },
      data: { visibility: CatalogListingVisibility.PUBLISHED },
      include: { provider: { include: { location: true } }, category: true },
    });
    const pubSummaries = await this.marketplaceUsers.fetchSummaries([
      updated.provider.userId,
    ]);
    return {
      listing: {
        ...this.mergeListingProviderIdentityFromSummaries(
          this.withComputedProviderStatus({
            ...updated,
            coverImage: await this.r2.expandImageRefsForResponse(updated.coverImage),
            serviceImages: await this.r2.expandImageRefsForResponse(updated.serviceImages),
          }),
          pubSummaries,
        ),
      },
    };
  }

  private async expandBookingForResponse<
    T extends {
      clientUserId: string;
      listing: {
        provider: Record<string, unknown>;
        coverImage: unknown;
        serviceImages: unknown;
      };
    },
  >(b: T, viewerUserId?: string) {
    const rawNotes = (b as { notes?: string | null }).notes;
    const cleanedNotes = this.stripSystemNotes(rawNotes);
    const flags = Array.from(this.extractSystemFlags(rawNotes));
    const bookingCommentsRaw = this.extractBookingComments(rawNotes);
    const clientUserId = String(b.clientUserId ?? '');
    const providerUserId = String((b.listing.provider as { userId?: string }).userId ?? '');
    const { summaries: bookingSummaries, participantContact } =
      await this.participantSummariesForBookingViewer(
        viewerUserId,
        clientUserId,
        providerUserId,
      );
    const commentAuthorUserIds = Array.from(
      new Set(bookingCommentsRaw.map((c) => c.authorUserId).filter(Boolean)),
    );
    const commentAuthorMap = commentAuthorUserIds.length
      ? await this.marketplaceUsers.fetchSummaries(commentAuthorUserIds)
      : new Map<string, MarketplaceUserContact>();
    const bookingComments = bookingCommentsRaw.map((c) => {
      const author = commentAuthorMap.get(c.authorUserId);
      const authorName =
        author?.displayName?.trim() ||
        author?.fullName?.trim() ||
        (c.authorUserId === clientUserId
          ? participantContact?.client?.displayName?.trim() ||
            participantContact?.client?.fullName?.trim() ||
            'Client'
          : c.authorUserId === providerUserId
            ? participantContact?.provider?.displayName?.trim() ||
              participantContact?.provider?.fullName?.trim() ||
              'Provider'
            : c.authorUserId);
      const authorRole =
        c.authorUserId === clientUserId
          ? 'client'
          : c.authorUserId === providerUserId
            ? 'provider'
            : 'participant';
      return {
        createdAt: c.createdAt,
        authorUserId: c.authorUserId,
        authorName,
        authorRole,
        message: c.message,
      };
    });
    const bookingAmount = new Prisma.Decimal(String((b as { amount?: unknown }).amount ?? 0));
    const custPlat = new Prisma.Decimal(
      String((b as { customerPlatformFeeAmount?: unknown }).customerPlatformFeeAmount ?? 0),
    );
    const provPlat = new Prisma.Decimal(
      String((b as { providerPlatformFeeAmount?: unknown }).providerPlatformFeeAmount ?? 0),
    );
    const paymentBreakdown = {
      serviceAmount: bookingAmount.toString(),
      customerPlatformFee: custPlat.toString(),
      providerPlatformFee: provPlat.toString(),
      totalDueFromCustomer: bookingAmount.add(custPlat).toString(),
      providerNetPayout: bookingAmount.sub(provPlat).toString(),
      platformTotalCollected: custPlat.add(provPlat).toString(),
    };
    return {
      ...b,
      notes: cleanedNotes,
      workflowFlags: flags,
      participantContact,
      bookingComments,
      paymentBreakdown,
      listing: {
        ...this.mergeListingProviderIdentityFromSummaries(
          this.withComputedProviderStatus(b.listing),
          bookingSummaries,
        ),
        coverImage: await this.r2.expandImageRefsForResponse(b.listing.coverImage),
        serviceImages: await this.r2.expandImageRefsForResponse(b.listing.serviceImages),
      },
    };
  }

  async updateBookingState(
    userId: string,
    bookingId: string,
    dto: UpdateServiceBookingDto,
  ) {
    const booking = await this.prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        provider: true,
        listing: {
          include: { category: true, provider: { include: { location: true } } },
        },
        review: true,
      },
    });
    if (!booking) throw new BadRequestException('booking not found');

    const isClient = booking.clientUserId === userId;
    const isProvider = booking.provider.userId === userId;
    if (!isClient && !isProvider) throw new ForbiddenException();

    const flags = this.extractSystemFlags(booking.notes);
    const has = (f: string) => flags.has(f);

    let nextStatus = booking.status;
    switch (dto.action) {
      case ServiceBookingActionDto.MARK_FUNDED:
        if (!isClient) throw new ForbiddenException();
        if (!has('client_completed_confirmed')) {
          throw new BadRequestException('work must be completed first');
        }
        if (has('funded')) {
          throw new BadRequestException('booking already funded');
        }
        if (booking.status !== ServiceBookingStatus.PENDING_PAYMENT) {
          throw new BadRequestException('booking must be pending payment');
        }
        nextStatus = ServiceBookingStatus.FUNDED;
        break;
      case ServiceBookingActionDto.PROVIDER_REACHED:
        if (!isProvider) throw new ForbiddenException();
        if (has('provider_reached')) {
          throw new BadRequestException('provider already marked reached');
        }
        if (has('client_completed_confirmed')) {
          throw new BadRequestException('booking is awaiting payment');
        }
        if (booking.status === ServiceBookingStatus.CANCELLED) {
          throw new BadRequestException('booking is cancelled');
        }
        if (booking.status === ServiceBookingStatus.REFUNDED) {
          throw new BadRequestException('booking is refunded');
        }
        if (booking.status === ServiceBookingStatus.DISPUTED) {
          throw new BadRequestException('booking is disputed');
        }
        // Work starts before funding in this flow.
        nextStatus = ServiceBookingStatus.IN_PROGRESS;
        break;
      case ServiceBookingActionDto.CLIENT_CONFIRMED_REACHED:
        if (!isClient) throw new ForbiddenException();
        if (!has('provider_reached')) {
          throw new BadRequestException('provider must mark reached first');
        }
        if (has('client_confirmed_reached')) {
          throw new BadRequestException('already confirmed reached');
        }
        if (booking.status !== ServiceBookingStatus.IN_PROGRESS) {
          throw new BadRequestException('provider must mark reached first');
        }
        // stays IN_PROGRESS; this is an acknowledgement step.
        nextStatus = ServiceBookingStatus.IN_PROGRESS;
        break;
      case ServiceBookingActionDto.PROVIDER_FINISHED:
        if (!isProvider) throw new ForbiddenException();
        if (!has('client_confirmed_reached')) {
          throw new BadRequestException('client must confirm reached first');
        }
        if (has('provider_finished')) {
          throw new BadRequestException('provider already marked finished');
        }
        if (booking.status !== ServiceBookingStatus.IN_PROGRESS) {
          throw new BadRequestException('booking must be in progress');
        }
        nextStatus = ServiceBookingStatus.COMPLETED;
        break;
      case ServiceBookingActionDto.CLIENT_CONFIRMED_COMPLETED:
        if (!isClient) throw new ForbiddenException();
        if (!has('provider_finished')) {
          throw new BadRequestException('provider must mark finished first');
        }
        if (has('client_completed_confirmed')) {
          throw new BadRequestException('already confirmed completed');
        }
        if (booking.status !== ServiceBookingStatus.COMPLETED) {
          throw new BadRequestException('provider must mark finished first');
        }
        // After work completion confirmation, move to payment step.
        nextStatus = ServiceBookingStatus.PENDING_PAYMENT;
        break;
      case ServiceBookingActionDto.COMMENT:
        if (!dto.notes?.trim()) {
          throw new BadRequestException('comment cannot be empty');
        }
        // Keep the workflow status unchanged; this only appends a visible participant note.
        nextStatus = booking.status;
        break;
      case ServiceBookingActionDto.DISPUTE:
        if (
          booking.status === ServiceBookingStatus.CANCELLED ||
          booking.status === ServiceBookingStatus.REFUNDED
        ) {
          throw new BadRequestException('cannot dispute closed booking');
        }
        nextStatus = ServiceBookingStatus.DISPUTED;
        break;
      case ServiceBookingActionDto.CANCEL:
        if (!isClient) throw new ForbiddenException();
        if (
          booking.status !== ServiceBookingStatus.PENDING_PAYMENT &&
          booking.status !== ServiceBookingStatus.FUNDED
        ) {
          throw new BadRequestException('can only cancel before work starts');
        }
        nextStatus = ServiceBookingStatus.CANCELLED;
        break;
      default:
        throw new BadRequestException('unsupported booking action');
    }

    const note = dto.notes?.trim();
    let mergedNotes: string | null;
    if (dto.action === ServiceBookingActionDto.COMMENT) {
      mergedNotes = this.appendBookingComment(booking.notes, userId, note ?? '');
    } else {
      const withUserNote = [this.stripSystemNotes(booking.notes), note].filter(Boolean).join('\n');
      mergedNotes = withUserNote || null;
    }
    if (dto.action === ServiceBookingActionDto.PROVIDER_REACHED) {
      mergedNotes = this.appendSystemFlag(mergedNotes, 'provider_reached');
    } else if (dto.action === ServiceBookingActionDto.CLIENT_CONFIRMED_REACHED) {
      mergedNotes = this.appendSystemFlag(mergedNotes, 'client_confirmed_reached');
    } else if (dto.action === ServiceBookingActionDto.PROVIDER_FINISHED) {
      mergedNotes = this.appendSystemFlag(mergedNotes, 'provider_finished');
    } else if (dto.action === ServiceBookingActionDto.CLIENT_CONFIRMED_COMPLETED) {
      mergedNotes = this.appendSystemFlag(mergedNotes, 'client_completed_confirmed');
    } else if (dto.action === ServiceBookingActionDto.MARK_FUNDED) {
      mergedNotes = this.appendSystemFlag(mergedNotes, 'funded');
    }
    const updated = await this.prisma.serviceBooking.update({
      where: { id: bookingId },
      data: {
        status: nextStatus,
        notes: mergedNotes,
      },
      include: {
        listing: {
          include: { category: true, provider: { include: { location: true } } },
        },
        provider: true,
        review: true,
      },
    });

    const expandedBooking = await this.expandBookingForResponse(
      updated,
      userId,
    );
    if (dto.action === ServiceBookingActionDto.COMMENT) {
      this.bookingRealtime.emitBookingComments(
        bookingId,
        (expandedBooking.bookingComments ??
          []) as BookingCommentSocketPayload[],
      );
    }
    return {
      booking: expandedBooking,
      action: dto.action,
      by: isProvider ? 'provider' : 'client',
    };
  }
}
