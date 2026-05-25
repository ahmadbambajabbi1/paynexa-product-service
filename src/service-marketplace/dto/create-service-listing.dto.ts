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

export enum ServiceListingPriceTypeDto {
  FIXED = 'FIXED',
  RANGE = 'RANGE',
}

export class CreateServiceListingDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(8000)
  description!: string;

  @IsString()
  categoryId!: string;

  @IsOptional()
  @IsEnum(ServiceListingPriceTypeDto)
  priceType?: ServiceListingPriceTypeDto;

  @ValidateIf(
    (o: CreateServiceListingDto) =>
      (o.priceType ?? ServiceListingPriceTypeDto.FIXED) ===
      ServiceListingPriceTypeDto.FIXED,
  )
  @IsString()
  priceAmount!: string;

  @ValidateIf(
    (o: CreateServiceListingDto) =>
      (o.priceType ?? ServiceListingPriceTypeDto.FIXED) ===
      ServiceListingPriceTypeDto.RANGE,
  )
  @IsString()
  priceMin!: string;

  @ValidateIf(
    (o: CreateServiceListingDto) =>
      (o.priceType ?? ServiceListingPriceTypeDto.FIXED) ===
      ServiceListingPriceTypeDto.RANGE,
  )
  @IsString()
  priceMax!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedDeliveryMins?: number;

  @IsOptional()
  @IsArray()
  tags?: string[];

  /**
   * Media array of objects like:
   * [{ type: "image", url: "https://...", key?: "...", contentType?: "image/jpeg" }]
   */
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  media?: Record<string, unknown>[];
}
