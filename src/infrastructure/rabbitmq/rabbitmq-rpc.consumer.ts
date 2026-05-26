import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';
import { ProductsService } from '../../products/products.service';
import { ProductTypesService } from '../../product-types/product-types.service';
import { ServiceMarketplaceService } from '../../service-marketplace/service-marketplace.service';
import type { UpdateProductTypeDto } from '../../product-types/dto/update-product-type.dto';
import type { CreateServiceCategoryDto } from '../../service-marketplace/dto/create-service-category.dto';
import type { UpdateMarketplaceFeePolicyDto } from '../../service-marketplace/dto/update-marketplace-fee-policy.dto';

@Injectable()
export class RabbitmqRpcConsumer implements OnModuleInit {
  private readonly logger = new Logger(RabbitmqRpcConsumer.name);

  constructor(
    private readonly rabbit: RabbitmqService,
    private readonly products: ProductsService,
    private readonly productTypes: ProductTypesService,
    private readonly marketplace: ServiceMarketplaceService,
  ) {}

  async onModuleInit() {
    await this.rabbit.consumeRpc(
      'product-service.rpc',
      [
        'product.rpc.product.get',
        'product.rpc.product.get-full',
        'product.rpc.product-types.list',
        'product.rpc.product-types.patch',
        'product.rpc.product-types.delete',
        'product.rpc.service-categories.list',
        'product.rpc.service-categories.create',
        'product.rpc.marketplace-fees.get',
        'product.rpc.marketplace-fees.patch',
        'product.rpc.bookings.payment-breakdown',
        'product.rpc.product-types.create',
      ],
      async (routingKey, body) => {
        const b = body as Record<string, unknown>;

        switch (routingKey) {
          case 'product.rpc.product-types.create': {
            await this.productTypes.createFromEvent(b as any);
            return { ok: true };
          }

          case 'product.rpc.bookings.payment-breakdown': {
            return this.marketplace.getBookingPaymentBreakdownForInternal(b.bookingId as string);
          }

          case 'product.rpc.product.get': {
            return this.products.getOneInternal(b.productId as string);
          }

          case 'product.rpc.product.get-full': {
            return this.products.getOneForTransactionParticipant(b.productId as string);
          }

          case 'product.rpc.product-types.list': {
            const rows = await this.productTypes.listForInternal();
            return {
              productTypes: rows.map((r) => ({
                id: r.id,
                code: r.code,
                name: r.name,
                description: r.description,
                active: r.active,
                sortOrder: r.sortOrder,
                lawyerPricingEnabled: r.lawyerPricingEnabled,
                agentPricingEnabled: r.agentPricingEnabled,
                fieldDefinitions: r.fieldDefinitions,
                createdAt: r.createdAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
              })),
            };
          }

          case 'product.rpc.product-types.patch': {
            const updated = await this.productTypes.updateById(
              b.id as string,
              b.dto as UpdateProductTypeDto,
            );
            return {
              productType: {
                id: updated.id,
                code: updated.code,
                name: updated.name,
                description: updated.description,
                active: updated.active,
                sortOrder: updated.sortOrder,
                lawyerPricingEnabled: updated.lawyerPricingEnabled,
                agentPricingEnabled: updated.agentPricingEnabled,
                fieldDefinitions: updated.fieldDefinitions,
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
              },
            };
          }

          case 'product.rpc.product-types.delete': {
            await this.productTypes.removeById(b.id as string);
            return { ok: true };
          }

          case 'product.rpc.service-categories.list': {
            return this.marketplace.listCategories();
          }

          case 'product.rpc.service-categories.create': {
            return this.marketplace.createCategory(b.dto as CreateServiceCategoryDto);
          }

          case 'product.rpc.marketplace-fees.get': {
            return this.marketplace.getPublicMarketplaceFeePolicy();
          }

          case 'product.rpc.marketplace-fees.patch': {
            return this.marketplace.updateMarketplaceFeePolicy(b.dto as UpdateMarketplaceFeePolicyDto);
          }

          default:
            this.logger.warn(`Unknown RPC routing key: ${routingKey}`);
            throw new Error(`Unknown RPC routing key: ${routingKey}`);
        }
      },
    );
  }
}
