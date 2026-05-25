import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
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

  /** Exactly one storage key or URL: the listing banner image. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsString({ each: true })
  productImageUrls!: string[];

  /** At least one additional gallery image (also uploaded to server storage). */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  otherImageUrls!: string[];

  @IsObject()
  attributes!: Record<string, unknown>;
}
