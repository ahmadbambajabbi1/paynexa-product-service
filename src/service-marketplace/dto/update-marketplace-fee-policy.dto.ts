import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, Max, Min } from 'class-validator';

export class UpdateMarketplaceFeePolicyDto {
  @IsBoolean()
  providerFeeEnabled!: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  providerFeePercent!: number;

  @IsBoolean()
  customerFeeEnabled!: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  customerFeePercent!: number;
}
