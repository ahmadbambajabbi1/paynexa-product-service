import { IsString, Matches } from 'class-validator';

/** Decimal string, non-negative, up to 2 fractional digits. */
export class PutProfessionalFeeDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'feeAmount must be a non-negative decimal with at most 2 places',
  })
  feeAmount!: string;
}
