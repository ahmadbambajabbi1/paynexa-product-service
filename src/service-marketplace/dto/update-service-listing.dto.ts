import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ServiceListingPriceTypeDto } from './create-service-listing.dto';
import { CatalogListingVisibilityDto } from './service-listing-complete-metadata.dto';

export class UpdateServiceListingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ServiceListingPriceTypeDto)
  priceType?: ServiceListingPriceTypeDto;

  @ValidateIf(
    (o: UpdateServiceListingDto) =>
      (o.priceType ?? ServiceListingPriceTypeDto.FIXED) ===
        ServiceListingPriceTypeDto.FIXED && o.priceAmount != null,
  )
  @IsString()
  priceAmount?: string;

  @ValidateIf(
    (o: UpdateServiceListingDto) =>
      (o.priceType ?? ServiceListingPriceTypeDto.FIXED) ===
        ServiceListingPriceTypeDto.RANGE && o.priceMin != null,
  )
  @IsString()
  priceMin?: string;

  @ValidateIf(
    (o: UpdateServiceListingDto) =>
      (o.priceType ?? ServiceListingPriceTypeDto.FIXED) ===
        ServiceListingPriceTypeDto.RANGE && o.priceMax != null,
  )
  @IsString()
  priceMax?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedDeliveryMins?: number;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  media?: Record<string, unknown>[];

  @IsOptional()
  active?: boolean;

  @IsOptional()
  @IsEnum(CatalogListingVisibilityDto)
  visibility?: CatalogListingVisibilityDto;
}
