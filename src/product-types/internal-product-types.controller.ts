import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalSecretGuard } from '../internal/internal-secret.guard';
import { UpdateProductTypeDto } from './dto/update-product-type.dto';
import { ProductTypesService } from './product-types.service';
import type { ProductTypeCreatePayload } from './product-type-create.payload';

@Controller('internal/product-types')
@UseGuards(InternalSecretGuard)
export class InternalProductTypesController {
  constructor(private readonly productTypes: ProductTypesService) {}

  @Post()
  @HttpCode(202)
  async create(@Body() payload: ProductTypeCreatePayload) {
    await this.productTypes.createFromEvent(payload);
    return { accepted: true, clientRequestId: payload.clientRequestId };
  }

  @Get()
  async list() {
    const items = await this.productTypes.listForInternal();
    return { productTypes: items };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductTypeDto) {
    const productType = await this.productTypes.updateById(id, dto);
    return { productType };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.productTypes.removeById(id);
  }
}
