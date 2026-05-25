import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchServiceListingsDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  categoryCode?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.1)
  @Max(200)
  radiusKm?: number;

  @IsOptional()
  @IsISO8601()
  availableAt?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  minRating?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  onlineOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}
