import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CatalogListingVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { CreateProductDto } from './dto/create-product.dto';
import {
  CatalogProductVisibilityDto,
  type ProductCompleteMetadataDto,
} from './dto/product-complete-metadata.dto';
import type { ProductUpdateCompleteMetadataDto } from './dto/product-update-complete-metadata.dto';
import type { UpdateProductDetailsDto } from './dto/update-product-details.dto';
import { validateDynamicAttributes } from './attribute-validation';
import type { MemoryUploadedFile } from './product-image-mime.util';
import { resolveProductUploadMime } from './product-image-mime.util';
import {
  collectProductImageKeysDeep,
  jsonToStringArray,
} from './product-storage-keys.util';
import { R2UploadService } from './r2-upload.service';

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProductImageRef(s: string): boolean {
  return /^product_images\/[a-zA-Z0-9._/-]+$/.test(s);
}

function assertImageRefList(
  label: string,
  urls: string[],
  minLen: number,
): void {
  if (!Array.isArray(urls) || urls.length < minLen) {
    throw new BadRequestException(
      `${label} must have at least ${minLen} image reference(s)`,
    );
  }
  for (const u of urls) {
    if (typeof u !== 'string' || (!isHttpUrl(u) && !isProductImageRef(u))) {
      throw new BadRequestException(
        `${label} must contain only https URLs or product_images/… storage keys`,
      );
    }
  }
}

type ProductRowWithType = Prisma.ProductGetPayload<{
  include: { productType: true };
}>;

function listingTitleForTransaction(name: string, description: string): string {
  const n = name.trim();
  if (n.length > 0) return n;
  const d = description.trim();
  if (d.length <= 500) return d;
  return `${d.slice(0, 500)}…`;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2UploadService,
  ) {}

  private keysFromJsonArray(raw: unknown): string[] {
    return jsonToStringArray(raw).filter((s) => this.r2.isProductImageKey(s));
  }

  private allKeysOnProduct(
    productImages: unknown,
    otherImages: unknown,
    attributes: unknown,
  ): Set<string> {
    const out = new Set<string>();
    collectProductImageKeysDeep(productImages, out);
    collectProductImageKeysDeep(otherImages, out);
    collectProductImageKeysDeep(attributes, out);
    return out;
  }

  private async expandProductRow<
    T extends {
      productImages: unknown;
      otherImages: unknown;
      attributes: unknown;
    },
  >(row: T): Promise<T> {
    const [productImages, otherImages, attributes] = await Promise.all([
      this.r2.expandImageRefsForResponse(row.productImages),
      this.r2.expandImageRefsForResponse(row.otherImages),
      this.r2.expandImageRefsForResponse(row.attributes),
    ]);
    return {
      ...row,
      productImages,
      otherImages,
      attributes,
    };
  }

  /** Public API row: signed URLs + parallel storage keys for edit round-trips. */
  async toPublicRow(row: ProductRowWithType) {
    const productImageKeys = this.keysFromJsonArray(row.productImages);
    const otherImageKeys = this.keysFromJsonArray(row.otherImages);
    const expanded = await this.expandProductRow(row);
    return {
      ...expanded,
      productImageKeys,
      otherImageKeys,
    };
  }

  async create(sellerUserId: string, dto: CreateProductDto) {
    const pt = await this.prisma.productType.findFirst({
      where: { id: dto.productTypeId, active: true },
    });
    if (!pt) {
      throw new NotFoundException('Product type not found or inactive');
    }

    assertImageRefList('productImageUrls', dto.productImageUrls, 1);
    if (dto.productImageUrls.length !== 1) {
      throw new BadRequestException(
        'productImageUrls must contain exactly one banner image',
      );
    }
    const other = dto.otherImageUrls ?? [];
    assertImageRefList('otherImageUrls', other, 1);

    validateDynamicAttributes(pt.fieldDefinitions, dto.attributes);

    const productImages =
      dto.productImageUrls as unknown as Prisma.InputJsonValue;
    const otherImages = other as unknown as Prisma.InputJsonValue;
    const attributes = dto.attributes as unknown as Prisma.InputJsonValue;

    const created = await this.prisma.product.create({
      data: {
        sellerUserId,
        productTypeId: pt.id,
        visibility: CatalogListingVisibility.PUBLISHED,
        price: dto.price,
        name: dto.name.trim(),
        description: dto.description.trim(),
        productImages,
        otherImages,
        attributes,
      },
      include: { productType: true },
    });
    return this.toPublicRow(created);
  }

  /**
   * Upload banner + gallery to R2 only after validation, then persist the product (no orphan objects on cancel).
   */
  async createComplete(
    sellerUserId: string,
    meta: ProductCompleteMetadataDto,
    banner: MemoryUploadedFile,
    gallery: MemoryUploadedFile[],
  ) {
    if (!banner?.buffer?.length) {
      throw new BadRequestException('Missing banner image');
    }
    if (!gallery?.length) {
      throw new BadRequestException('At least one gallery image is required');
    }

    const pt = await this.prisma.productType.findFirst({
      where: { id: meta.productTypeId, active: true },
    });
    if (!pt) {
      throw new NotFoundException('Product type not found or inactive');
    }

    validateDynamicAttributes(pt.fieldDefinitions, meta.attributes);

    const ctBanner = resolveProductUploadMime(banner);
    if (!ctBanner) {
      throw new BadRequestException(
        'Banner: unsupported or missing image type',
      );
    }
    const { key: bannerKey } = await this.r2.uploadProductImage({
      sellerUserId,
      buffer: banner.buffer,
      contentType: ctBanner,
      originalName: banner.originalname,
    });

    const galleryKeys: string[] = [];
    try {
      for (const g of gallery) {
        if (!g?.buffer?.length) {
          throw new BadRequestException('Empty gallery file');
        }
        const ct = resolveProductUploadMime(g);
        if (!ct) {
          throw new BadRequestException(
            'Gallery: unsupported or missing image type',
          );
        }
        const { key } = await this.r2.uploadProductImage({
          sellerUserId,
          buffer: g.buffer,
          contentType: ct,
          originalName: g.originalname,
        });
        galleryKeys.push(key);
      }

      const visibility =
        meta.visibility === CatalogProductVisibilityDto.DRAFT
          ? CatalogListingVisibility.DRAFT
          : CatalogListingVisibility.PUBLISHED;
      const created = await this.prisma.product.create({
        data: {
          sellerUserId,
          productTypeId: pt.id,
          visibility,
          price: meta.price,
          name: meta.name.trim(),
          description: meta.description.trim(),
          productImages: [bannerKey] as unknown as Prisma.InputJsonValue,
          otherImages: galleryKeys as unknown as Prisma.InputJsonValue,
          attributes: meta.attributes as unknown as Prisma.InputJsonValue,
        },
        include: { productType: true },
      });
      return this.toPublicRow(created);
    } catch (e) {
      const uploaded = new Set<string>([bannerKey, ...galleryKeys]);
      await this.r2.deleteKeysForSeller(sellerUserId, uploaded);
      throw e;
    }
  }

  async updateComplete(
    sellerUserId: string,
    productId: string,
    meta: ProductUpdateCompleteMetadataDto,
    bannerFile: MemoryUploadedFile | undefined,
    galleryFiles: MemoryUploadedFile[],
  ) {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }

    const oldKeys = this.allKeysOnProduct(
      row.productImages,
      row.otherImages,
      row.attributes,
    );
    const dbBannerKeys = this.keysFromJsonArray(row.productImages);
    const dbGalleryKeys = this.keysFromJsonArray(row.otherImages);
    if (dbBannerKeys.length !== 1) {
      throw new BadRequestException(
        'Product has invalid stored banner; contact support',
      );
    }
    const dbBanner = dbBannerKeys[0];
    const dbGallerySet = new Set(dbGalleryKeys);

    if (bannerFile) {
      if (meta.keepProductImageKeys.length > 0) {
        throw new BadRequestException(
          'Omit keepProductImageKeys when uploading a new banner file',
        );
      }
    } else {
      if (meta.keepProductImageKeys.length !== 1) {
        throw new BadRequestException(
          'keepProductImageKeys must contain exactly one key when not uploading a new banner',
        );
      }
      if (meta.keepProductImageKeys[0] !== dbBanner) {
        throw new BadRequestException(
          'keepProductImageKeys must include the current banner key',
        );
      }
    }

    for (const k of meta.keepOtherImageKeys) {
      if (!dbGallerySet.has(k)) {
        throw new BadRequestException(`Unknown gallery key to keep: ${k}`);
      }
    }

    const newUploaded: string[] = [];
    try {
      let newBannerKey: string;
      if (bannerFile?.buffer?.length) {
        const ct = resolveProductUploadMime(bannerFile);
        if (!ct) {
          throw new BadRequestException(
            'Banner: unsupported or missing image type',
          );
        }
        const { key } = await this.r2.uploadProductImage({
          sellerUserId,
          buffer: bannerFile.buffer,
          contentType: ct,
          originalName: bannerFile.originalname,
        });
        newBannerKey = key;
        newUploaded.push(key);
      } else {
        newBannerKey = dbBanner;
      }

      const newGalleryKeys = [...meta.keepOtherImageKeys];
      for (const g of galleryFiles) {
        if (!g?.buffer?.length) continue;
        const ct = resolveProductUploadMime(g);
        if (!ct) {
          throw new BadRequestException(
            'Gallery: unsupported or missing image type',
          );
        }
        const { key } = await this.r2.uploadProductImage({
          sellerUserId,
          buffer: g.buffer,
          contentType: ct,
          originalName: g.originalname,
        });
        newGalleryKeys.push(key);
        newUploaded.push(key);
      }

      if (newGalleryKeys.length < 1) {
        throw new BadRequestException('At least one gallery image is required');
      }

      const description =
        meta.description !== undefined
          ? meta.description.trim()
          : row.description;
      const name = meta.name !== undefined ? meta.name.trim() : row.name;
      const attributes =
        meta.attributes !== undefined
          ? meta.attributes
          : (row.attributes as Record<string, unknown>);

      validateDynamicAttributes(row.productType.fieldDefinitions, attributes);

      const updated = await this.prisma.product.update({
        where: { id: productId },
        data: {
          price: meta.price ?? row.price,
          name,
          description,
          productImages: [newBannerKey] as unknown as Prisma.InputJsonValue,
          otherImages: newGalleryKeys as unknown as Prisma.InputJsonValue,
          attributes: attributes as unknown as Prisma.InputJsonValue,
        },
        include: { productType: true },
      });

      const newReferenced = this.allKeysOnProduct(
        updated.productImages,
        updated.otherImages,
        updated.attributes,
      );
      const toDelete = [...oldKeys].filter((k) => !newReferenced.has(k));
      await this.r2.deleteKeysForSeller(sellerUserId, toDelete);

      return this.toPublicRow(updated);
    } catch (e) {
      await this.r2.deleteKeysForSeller(sellerUserId, newUploaded);
      throw e;
    }
  }

  async remove(sellerUserId: string, id: string) {
    const row = await this.prisma.product.findFirst({
      where: { id, sellerUserId },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    const keys = this.allKeysOnProduct(
      row.productImages,
      row.otherImages,
      row.attributes,
    );
    await this.r2.deleteKeysForSeller(sellerUserId, keys);
    await this.prisma.product.delete({ where: { id } });
  }

  async listForSeller(
    sellerUserId: string,
    viewerUserId: string,
    page: number,
    pageSize: number,
  ) {
    const skip = (page - 1) * pageSize;
    const hideDraftsFromOthers = viewerUserId !== sellerUserId;
    const where: Prisma.ProductWhereInput = {
      sellerUserId,
      ...(hideDraftsFromOthers
        ? { visibility: CatalogListingVisibility.PUBLISHED }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { productType: true },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const expanded = await Promise.all(items.map((r) => this.toPublicRow(r)));
    return { items: expanded, page, pageSize, total, totalPages };
  }

  async getOneForSeller(sellerUserId: string, id: string) {
    const row = await this.prisma.product.findFirst({
      where: { id, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    return this.toPublicRow(row);
  }

  async getOneInternal(id: string) {
    const row = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        sellerUserId: true,
        visibility: true,
        name: true,
        description: true,
        price: true,
        productType: {
          select: {
            code: true,
            lawyerPricingEnabled: true,
            agentPricingEnabled: true,
          },
        },
      },
    });
    if (
      row &&
      row.visibility !== CatalogListingVisibility.PUBLISHED
    ) {
      throw new NotFoundException('Product not found');
    }
    if (!row) {
      // Service marketplace listings also participate in transaction-service escrow rooms.
      const listing = await this.prisma.serviceListing.findUnique({
        where: { id },
        select: {
          id: true,
          visibility: true,
          title: true,
          description: true,
          priceType: true,
          priceAmount: true,
          priceMin: true,
          priceMax: true,
          provider: { select: { userId: true } },
          category: { select: { code: true } },
        },
      });
      if (!listing) {
        throw new NotFoundException('Product not found');
      }
      if (listing.visibility !== CatalogListingVisibility.PUBLISHED) {
        throw new NotFoundException('Product not found');
      }
      const price =
        listing.priceType === 'FIXED'
          ? listing.priceAmount
          : (listing.priceMin ?? listing.priceMax);
      if (!price) {
        throw new NotFoundException('Product not found');
      }
      return {
        id: listing.id,
        sellerUserId: listing.provider.userId,
        title: listingTitleForTransaction(listing.title, listing.description),
        price: price.toString(),
        productTypeCode: `service_${listing.category.code}`,
        lawyerPricingEnabled: false,
        agentPricingEnabled: false,
      };
    }
    return {
      id: row.id,
      sellerUserId: row.sellerUserId,
      title: listingTitleForTransaction(row.name, row.description),
      price: row.price.toString(),
      productTypeCode: row.productType.code,
      lawyerPricingEnabled: row.productType.lawyerPricingEnabled,
      agentPricingEnabled: row.productType.agentPricingEnabled,
    };
  }

  /** Full public row for transaction room (buyer + seller). Server-to-server only. */
  async getOneForTransactionParticipant(id: string) {
    const row = await this.prisma.product.findFirst({
      where: { id, visibility: CatalogListingVisibility.PUBLISHED },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    return this.toPublicRow(row);
  }

  async publishProductListing(sellerUserId: string, productId: string) {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { visibility: CatalogListingVisibility.PUBLISHED },
      include: { productType: true },
    });
    return this.toPublicRow(updated);
  }

  async updateDetailsOnly(
    sellerUserId: string,
    productId: string,
    dto: UpdateProductDetailsDto,
  ) {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    const description =
      dto.description !== undefined ? dto.description.trim() : row.description;
    const name = dto.name !== undefined ? dto.name.trim() : row.name;
    const attributes =
      dto.attributes !== undefined
        ? dto.attributes
        : (row.attributes as Record<string, unknown>);
    validateDynamicAttributes(row.productType.fieldDefinitions, attributes);
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        price: dto.price ?? row.price,
        name,
        description,
        attributes: attributes as unknown as Prisma.InputJsonValue,
      },
      include: { productType: true },
    });
    return this.toPublicRow(updated);
  }

  async replaceBanner(
    sellerUserId: string,
    productId: string,
    file: MemoryUploadedFile,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing banner file');
    }
    const row = await this.prisma.product.findFirst({
      where: { id: productId, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    const prevKeys = this.keysFromJsonArray(row.productImages);
    if (prevKeys.length !== 1) {
      throw new BadRequestException('Invalid stored banner');
    }
    const oldBanner = prevKeys[0];
    const ct = resolveProductUploadMime(file);
    if (!ct) {
      throw new BadRequestException('Unsupported or missing image type');
    }
    const { key } = await this.r2.uploadProductImage({
      sellerUserId,
      buffer: file.buffer,
      contentType: ct,
      originalName: file.originalname,
    });
    try {
      const updated = await this.prisma.product.update({
        where: { id: productId },
        data: {
          productImages: [key] as unknown as Prisma.InputJsonValue,
        },
        include: { productType: true },
      });
      if (oldBanner !== key) {
        await this.r2.deleteKeysForSeller(sellerUserId, [oldBanner]);
      }
      return this.toPublicRow(updated);
    } catch (e) {
      await this.r2.deleteKeysForSeller(sellerUserId, [key]);
      throw e;
    }
  }

  async appendGalleryImages(
    sellerUserId: string,
    productId: string,
    files: MemoryUploadedFile[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('No gallery files');
    }
    const row = await this.prisma.product.findFirst({
      where: { id: productId, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    const existing = this.keysFromJsonArray(row.otherImages);
    const newKeys: string[] = [];
    try {
      for (const f of files) {
        if (!f?.buffer?.length) continue;
        const ct = resolveProductUploadMime(f);
        if (!ct) {
          throw new BadRequestException(
            'Gallery: unsupported or missing image type',
          );
        }
        const { key } = await this.r2.uploadProductImage({
          sellerUserId,
          buffer: f.buffer,
          contentType: ct,
          originalName: f.originalname,
        });
        newKeys.push(key);
      }
      if (newKeys.length === 0) {
        throw new BadRequestException('No valid gallery files');
      }
      const merged = [...existing, ...newKeys];
      const updated = await this.prisma.product.update({
        where: { id: productId },
        data: {
          otherImages: merged as unknown as Prisma.InputJsonValue,
        },
        include: { productType: true },
      });
      return this.toPublicRow(updated);
    } catch (e) {
      await this.r2.deleteKeysForSeller(sellerUserId, newKeys);
      throw e;
    }
  }

  async removeGalleryKeys(
    sellerUserId: string,
    productId: string,
    keys: string[],
  ) {
    const row = await this.prisma.product.findFirst({
      where: { id: productId, sellerUserId },
      include: { productType: true },
    });
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    const bannerKeys = this.keysFromJsonArray(row.productImages);
    const gallery = this.keysFromJsonArray(row.otherImages);
    if (bannerKeys.length !== 1) {
      throw new BadRequestException('Invalid product images');
    }
    const bannerKey = bannerKeys[0];
    const gallerySet = new Set(gallery);
    for (const k of keys) {
      if (!this.r2.isProductImageKey(k) || !gallerySet.has(k)) {
        throw new BadRequestException(
          `Not a gallery image on this listing: ${k}`,
        );
      }
      if (k === bannerKey) {
        throw new BadRequestException(
          'Use “change cover” to replace the banner, not remove.',
        );
      }
    }
    const nextGallery = gallery.filter((k) => !keys.includes(k));
    if (nextGallery.length < 1) {
      throw new BadRequestException('At least one gallery image must remain');
    }
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        otherImages: nextGallery as unknown as Prisma.InputJsonValue,
      },
      include: { productType: true },
    });
    await this.r2.deleteKeysForSeller(sellerUserId, keys);
    const refreshed = await this.prisma.product.findFirst({
      where: { id: productId },
      include: { productType: true },
    });
    return this.toPublicRow(refreshed!);
  }
}
