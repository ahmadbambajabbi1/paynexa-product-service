import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum CatalogProductVisibilityDto {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

/** JSON string field `metadata` on multipart POST /products/complete */
export class ProductCompleteMetadataDto {
  @IsString()
  @MaxLength(64)
  productTypeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(20000)
  description!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsObject()
  attributes!: Record<string, unknown>;

  @IsOptional()
  @IsEnum(CatalogProductVisibilityDto)
  visibility?: CatalogProductVisibilityDto;
}
