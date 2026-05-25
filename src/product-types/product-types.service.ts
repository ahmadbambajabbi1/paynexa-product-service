import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { ProductTypeCreatePayload } from './product-type-create.payload';
import type { UpdateProductTypeDto } from './dto/update-product-type.dto';
import {
  normalizeFieldDefinitionsFromDtos,
  parseFieldDefinitionsFromEventPayload,
} from './field-definitions.util';

const CODE_RE = /^[a-z][a-z0-9_]{1,62}$/;

@Injectable()
export class ProductTypesService {
  private readonly logger = new Logger(ProductTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  listForInternal() {
    return this.prisma.productType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Active types for seller product forms (field definitions included). */
  listActiveForCatalog() {
    return this.prisma.productType.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        fieldDefinitions: true,
        lawyerPricingEnabled: true,
        agentPricingEnabled: true,
      },
    });
  }

  /**
   * Idempotent on `clientRequestId`; rejects duplicate `code` without rethrowing to the broker (ack).
   */
  async createFromEvent(payload: ProductTypeCreatePayload): Promise<void> {
    if (!CODE_RE.test(payload.code)) {
      this.logger.warn(`Invalid product type code in event: ${payload.code}`);
      return;
    }
    if (!payload.name?.trim() || payload.name.length > 120) {
      this.logger.warn('Invalid product type name in event');
      return;
    }
    if (payload.description != null && payload.description.length > 2000) {
      this.logger.warn('Invalid product type description in event');
      return;
    }
    const sortOrder =
      typeof payload.sortOrder === 'number' &&
      Number.isFinite(payload.sortOrder)
        ? Math.max(0, Math.floor(payload.sortOrder))
        : 0;
    const lawyerPricingEnabled = payload.lawyerPricingEnabled === true;
    const agentPricingEnabled = payload.agentPricingEnabled === true;
    const fieldDefinitions = parseFieldDefinitionsFromEventPayload(
      payload.fieldDefinitions,
    );

    const existingIdempotent = await this.prisma.productType.findUnique({
      where: { clientRequestId: payload.clientRequestId },
    });
    if (existingIdempotent) {
      return;
    }

    try {
      await this.prisma.productType.create({
        data: {
          code: payload.code,
          name: payload.name.trim(),
          description: payload.description?.trim() || null,
          sortOrder,
          lawyerPricingEnabled,
          agentPricingEnabled,
          fieldDefinitions,
          clientRequestId: payload.clientRequestId,
          createdByAdminId: payload.adminUserId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          const target = e.meta?.target;
          const t = Array.isArray(target) ? target.join(',') : String(target);
          if (t.includes('clientRequestId')) {
            return;
          }
          this.logger.warn(
            `Duplicate product type code rejected: ${payload.code}`,
          );
          return;
        }
      }
      throw e;
    }
  }

  async updateById(id: string, dto: UpdateProductTypeDto) {
    const data: Prisma.ProductTypeUpdateInput = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n.length) {
        throw new BadRequestException('name cannot be empty');
      }
      data.name = n;
    }
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = Math.max(0, Math.floor(dto.sortOrder));
    }
    if (dto.lawyerPricingEnabled !== undefined) {
      data.lawyerPricingEnabled = dto.lawyerPricingEnabled;
    }
    if (dto.agentPricingEnabled !== undefined) {
      data.agentPricingEnabled = dto.agentPricingEnabled;
    }
    if (dto.fieldDefinitions !== undefined) {
      data.fieldDefinitions = normalizeFieldDefinitionsFromDtos(
        dto.fieldDefinitions,
      );
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }
    try {
      return await this.prisma.productType.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Product type not found');
      }
      throw e;
    }
  }

  async removeById(id: string): Promise<void> {
    try {
      await this.prisma.productType.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Product type not found');
      }
      throw e;
    }
  }
}
