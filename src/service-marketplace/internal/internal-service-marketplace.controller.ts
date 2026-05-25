import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { InternalSecretGuard } from '../../internal/internal-secret.guard';
import { CreateServiceCategoryDto } from '../dto/create-service-category.dto';
import { UpdateMarketplaceFeePolicyDto } from '../dto/update-marketplace-fee-policy.dto';
import { ServiceMarketplaceService } from '../service-marketplace.service';

@Controller('internal/service-marketplace')
@UseGuards(InternalSecretGuard)
export class InternalServiceMarketplaceController {
  constructor(private readonly sm: ServiceMarketplaceService) {}

  @Get('categories')
  listCategoriesInternal() {
    // Admin can see inactive too later; for now reuse public.
    return this.sm.listCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateServiceCategoryDto) {
    return this.sm.createCategory(dto);
  }

  @Get('fee-policy')
  getFeePolicy() {
    return this.sm.getPublicMarketplaceFeePolicy();
  }

  @Patch('fee-policy')
  patchFeePolicy(@Body() dto: UpdateMarketplaceFeePolicyDto) {
    return this.sm.updateMarketplaceFeePolicy(dto);
  }

  @Get('bookings/:bookingId/payment-breakdown')
  bookingPaymentBreakdown(@Param('bookingId') bookingId: string) {
    return this.sm.getBookingPaymentBreakdownForInternal(bookingId);
  }
}
