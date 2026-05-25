import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { InternalSecretGuard } from '../internal/internal-secret.guard';
import { ProductsService } from './products.service';

@Controller('products/internal')
export class InternalProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Full listing (images, attributes) for transaction-service room enrichment. */
  @Get('full/:id')
  @UseGuards(InternalSecretGuard)
  getFullForTransaction(@Param('id') id: string) {
    return this.products.getOneForTransactionParticipant(id);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.products.getOneInternal(id);
  }
}
