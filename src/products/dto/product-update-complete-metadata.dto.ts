import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** JSON string field `metadata` on multipart PATCH /products/:id/complete */
export class ProductUpdateCompleteMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  /**
   * Existing banner key to keep when not uploading a new `banner` file.
   * Must be exactly one key, owned by this product, when `banner` file is absent.
   */
  @IsArray()
  @IsString({ each: true })
  keepProductImageKeys!: string[];

  /** Gallery keys to retain; combined with newly uploaded `gallery` parts. */
  @IsArray()
  @IsString({ each: true })
  keepOtherImageKeys!: string[];
}
