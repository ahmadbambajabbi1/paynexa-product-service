import { Module } from '@nestjs/common';
import { ProductTypesModule } from '../product-types/product-types.module';
import { InternalSecretGuard } from '../internal/internal-secret.guard';
import { InternalProductsController } from './internal-products.controller';
import { ProductsController } from './products.controller';
import { ProfessionalFeesService } from './professional-fees.service';
import { ProductsService } from './products.service';
import { R2UploadService } from './r2-upload.service';

@Module({
  imports: [ProductTypesModule],
  controllers: [ProductsController, InternalProductsController],
  providers: [
    ProductsService,
    ProfessionalFeesService,
    R2UploadService,
    InternalSecretGuard,
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
