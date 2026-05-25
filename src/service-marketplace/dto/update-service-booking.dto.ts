import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ServiceBookingActionDto {
  MARK_FUNDED = 'MARK_FUNDED',
  PROVIDER_REACHED = 'PROVIDER_REACHED',
  CLIENT_CONFIRMED_REACHED = 'CLIENT_CONFIRMED_REACHED',
  PROVIDER_FINISHED = 'PROVIDER_FINISHED',
  CLIENT_CONFIRMED_COMPLETED = 'CLIENT_CONFIRMED_COMPLETED',
  COMMENT = 'COMMENT',
  DISPUTE = 'DISPUTE',
  CANCEL = 'CANCEL',
}

export class UpdateServiceBookingDto {
  @IsEnum(ServiceBookingActionDto)
  action!: ServiceBookingActionDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

