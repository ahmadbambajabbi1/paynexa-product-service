import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitmqService } from '../infrastructure/rabbitmq/rabbitmq.service';
import { isProductTypeCreatePayload } from './product-type-create.payload';
import { ProductTypesService } from './product-types.service';

export const PRODUCT_TYPE_CREATE_ROUTING_KEY = 'productType.create';

@Injectable()
export class ProductTypeEventsListener implements OnModuleInit {
  private readonly logger = new Logger(ProductTypeEventsListener.name);

  constructor(
    private readonly rabbit: RabbitmqService,
    private readonly productTypes: ProductTypesService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.rabbit.canPublishOrConsume()) {
      this.logger.warn(
        'RabbitMQ unavailable; product type consumer not started',
      );
      return;
    }
    await this.rabbit.consume(
      'safetrade.product-service',
      [PRODUCT_TYPE_CREATE_ROUTING_KEY],
      async (routingKey, body) => {
        this.logger.log(
          `Consumed ${routingKey}: ${JSON.stringify(body).slice(0, 200)}`,
        );
        if (!isProductTypeCreatePayload(body)) {
          this.logger.warn('Malformed productType.create payload; skipping');
          return;
        }
        await this.productTypes.createFromEvent(body);
      },
    );
  }
}
