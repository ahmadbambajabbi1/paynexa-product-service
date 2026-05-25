import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class ListProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 12;

  /** When set, list this seller’s listings (e.g. buyer picking counterparty’s product). Omit for “my” listings. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  sellerUserId?: string;
}
