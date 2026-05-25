import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FileFieldsInterceptor,
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductTypesService } from '../product-types/product-types.service';
import {
  SessionAuthGuard,
  type AuthedRequest,
} from '../auth/session-auth.guard';
import { PutProfessionalFeeDto } from './dto/put-professional-fee.dto';
import { ProfessionalFeesService } from './professional-fees.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductCompleteMetadataDto } from './dto/product-complete-metadata.dto';
import { ProductUpdateCompleteMetadataDto } from './dto/product-update-complete-metadata.dto';
import { RemoveProductImagesDto } from './dto/remove-product-images.dto';
import { UpdateProductDetailsDto } from './dto/update-product-details.dto';
import { ProductsService } from './products.service';
import type { MemoryUploadedFile } from './product-image-mime.util';
import { resolveProductUploadMime } from './product-image-mime.util';
import { R2UploadService } from './r2-upload.service';

const multerLimits = { fileSize: 15 * 1024 * 1024 };

function parseMultipartMetadata<T extends object>(
  cls: new () => T,
  raw: unknown,
): T {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new BadRequestException('Missing metadata (JSON string)');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('metadata must be valid JSON');
  }
  const meta = plainToInstance(cls, parsed);
  const errs = validateSync(meta as object, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errs.length) {
    const parts = errs.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new BadRequestException(parts.join('; ') || 'Invalid metadata');
  }
  return meta;
}

@Controller('products')
@UseGuards(SessionAuthGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly productTypes: ProductTypesService,
    private readonly professionalFees: ProfessionalFeesService,
    private readonly r2: R2UploadService,
  ) {}

  @Get('meta/product-types')
  metaProductTypes() {
    return this.productTypes.listActiveForCatalog();
  }

  @Get('me/professional-fees')
  listProfessionalFees(@Req() req: AuthedRequest) {
    const role = req.user.professionalRole;
    if (!role) {
      throw new ForbiddenException();
    }
    return this.professionalFees.listForUser(req.user.id, role);
  }

  @Put('me/professional-fees/:productTypeId')
  async putProfessionalFee(
    @Param('productTypeId') productTypeId: string,
    @Body() dto: PutProfessionalFeeDto,
    @Req() req: AuthedRequest,
  ) {
    const role = req.user.professionalRole;
    if (!role) {
      throw new ForbiddenException();
    }
    const d = new Prisma.Decimal(dto.feeAmount.trim());
    if (d.isNaN() || d.lt(0)) {
      throw new BadRequestException('invalid feeAmount');
    }
    return this.professionalFees.upsertFee(req.user.id, role, productTypeId, d);
  }

  /**
   * Create listing: uploads run only after validation, then DB insert (cancel on device leaves no R2 objects).
   */
  @Post('complete')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'banner', maxCount: 1 },
        { name: 'gallery', maxCount: 24 },
      ],
      { limits: multerLimits },
    ),
  )
  async createComplete(
    @UploadedFiles()
    files: { banner?: MemoryUploadedFile[]; gallery?: MemoryUploadedFile[] },
    @Body('metadata') metadataRaw: unknown,
    @Req() req: AuthedRequest,
  ) {
    const meta = parseMultipartMetadata(
      ProductCompleteMetadataDto,
      metadataRaw,
    );
    const banner = files.banner?.[0];
    if (!banner?.buffer?.length) {
      throw new BadRequestException('Missing banner file');
    }
    const gallery = files.gallery ?? [];
    return this.products.createComplete(req.user.id, meta, banner, gallery);
  }

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { limits: multerLimits }))
  async uploadProductFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @Req() req: AuthedRequest,
  ): Promise<{ key: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing file');
    }
    const ct = resolveProductUploadMime(file);
    if (!ct) {
      throw new BadRequestException(
        'Unsupported or missing image type. Use a normal photo (JPEG, PNG, HEIC, WebP, etc.), or ensure the upload sends a correct Content-Type.',
      );
    }
    return this.r2.uploadProductImage({
      sellerUserId: req.user.id,
      buffer: file.buffer,
      contentType: ct,
      originalName: file.originalname,
    });
  }

  @Get()
  async list(@Query() query: ListProductsQueryDto, @Req() req: AuthedRequest) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const sellerId = query.sellerUserId?.trim() || req.user.id;
    return this.products.listForSeller(sellerId, req.user.id, page, pageSize);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @Req() req: AuthedRequest) {
    return this.products.create(req.user.id, dto);
  }

  @Patch(':id/complete')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'banner', maxCount: 1 },
        { name: 'gallery', maxCount: 24 },
      ],
      { limits: multerLimits },
    ),
  )
  async updateComplete(
    @Param('id') id: string,
    @UploadedFiles()
    files: { banner?: MemoryUploadedFile[]; gallery?: MemoryUploadedFile[] },
    @Body('metadata') metadataRaw: unknown,
    @Req() req: AuthedRequest,
  ) {
    const meta = parseMultipartMetadata(
      ProductUpdateCompleteMetadataDto,
      metadataRaw,
    );
    const banner = files.banner?.[0];
    const gallery = files.gallery ?? [];
    return this.products.updateComplete(req.user.id, id, meta, banner, gallery);
  }

  /** Description + attributes only (no image changes). */
  @Patch(':id/details')
  updateDetails(
    @Param('id') id: string,
    @Body() dto: UpdateProductDetailsDto,
    @Req() req: AuthedRequest,
  ) {
    return this.products.updateDetailsOnly(req.user.id, id, dto);
  }

  @Post(':id/images/banner')
  @UseInterceptors(FileInterceptor('file', { limits: multerLimits }))
  replaceBanner(
    @Param('id') id: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @Req() req: AuthedRequest,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing file');
    }
    return this.products.replaceBanner(req.user.id, id, file);
  }

  @Post(':id/images/gallery')
  @UseInterceptors(FilesInterceptor('gallery', 24, { limits: multerLimits }))
  appendGallery(
    @Param('id') id: string,
    @UploadedFiles() files: MemoryUploadedFile[],
    @Req() req: AuthedRequest,
  ) {
    return this.products.appendGalleryImages(req.user.id, id, files ?? []);
  }

  @Delete(':id/images')
  removeGalleryImages(
    @Param('id') id: string,
    @Body() body: RemoveProductImagesDto,
    @Req() req: AuthedRequest,
  ) {
    return this.products.removeGalleryKeys(req.user.id, id, body.keys);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.products.remove(req.user.id, id);
    return { ok: true };
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.products.publishProductListing(req.user.id, id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.products.getOneForSeller(req.user.id, id);
  }
}
