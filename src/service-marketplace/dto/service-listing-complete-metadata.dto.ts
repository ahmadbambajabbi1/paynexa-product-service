import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ServiceListingPriceTypeDto } from './create-service-listing.dto';
import { IsEnum } from 'class-validator';

export enum CatalogListingVisibilityDto {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

/** JSON string field `metadata` on multipart POST /service-marketplace/listings/complete */
export class ServiceListingCompleteMetadataDto {
  @IsString()
  @MaxLength(64)
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(20000)
  description!: string;

  @IsOptional()
  @IsEnum(ServiceListingPriceTypeDto)
  priceType?: ServiceListingPriceTypeDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedDeliveryMins?: number;

  /** Where you render this service (GPS); stored on provider for distance search. */
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsEnum(CatalogListingVisibilityDto)
  visibility?: CatalogListingVisibilityDto;
}

