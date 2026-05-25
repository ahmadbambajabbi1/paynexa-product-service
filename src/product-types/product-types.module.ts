import { Module } from '@nestjs/common';
import { InternalProductTypesController } from './internal-product-types.controller';
import { ProductTypeEventsListener } from './product-type-events.listener';
import { ProductTypesService } from './product-types.service';

@Module({
  controllers: [InternalProductTypesController],
  providers: [ProductTypesService, ProductTypeEventsListener],
  exports: [ProductTypesService],
})
export class ProductTypesModule {}
