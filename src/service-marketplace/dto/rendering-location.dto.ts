import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class RenderingLocationDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Human-readable place name (e.g. reverse-geocoded); stored on provider ServiceLocation.addressText. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationLabel?: string;
}
