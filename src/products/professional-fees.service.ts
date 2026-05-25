import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProfessionalFeeRole } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

@Injectable()
export class ProfessionalFeesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, role: 'LAWYER' | 'AGENT') {
    const prismaRole = role as ProfessionalFeeRole;
    const roleFilter =
      role === 'LAWYER'
        ? { lawyerPricingEnabled: true }
        : { agentPricingEnabled: true };
    const types = await this.prisma.productType.findMany({
      where: { active: true, ...roleFilter },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true },
    });
    const fees = await this.prisma.professionalProductTypeFee.findMany({
      where: { userId, role: prismaRole },
    });
    const byPt = new Map(fees.map((f) => [f.productTypeId, f]));
    return {
      role,
      items: types.map((t) => {
        const row = byPt.get(t.id);
        return {
          productTypeId: t.id,
          code: t.code,
          name: t.name,
          feeAmount: row ? row.feeAmount.toFixed(2) : null,
        };
      }),
    };
  }

  async upsertFee(
    userId: string,
    role: 'LAWYER' | 'AGENT',
    productTypeId: string,
    feeAmount: Prisma.Decimal,
  ) {
    const prismaRole = role as ProfessionalFeeRole;
    const pt = await this.prisma.productType.findFirst({
      where: { id: productTypeId, active: true },
    });
    if (!pt) {
      throw new NotFoundException('product type not found');
    }
    const allowed =
      role === 'LAWYER' ? pt.lawyerPricingEnabled : pt.agentPricingEnabled;
    if (!allowed) {
      throw new ForbiddenException('pricing not enabled for this product type');
    }
    const row = await this.prisma.professionalProductTypeFee.upsert({
      where: {
        userId_productTypeId: { userId, productTypeId },
      },
      create: {
        userId,
        productTypeId,
        role: prismaRole,
        feeAmount,
      },
      update: {
        feeAmount,
        role: prismaRole,
      },
    });
    return {
      productTypeId: row.productTypeId,
      feeAmount: row.feeAmount.toFixed(2),
    };
  }
}
