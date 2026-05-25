import { IsEnum } from 'class-validator';

export enum ProviderStatusDto {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  AWAY = 'AWAY',
}

export class SetProviderStatusDto {
  @IsEnum(ProviderStatusDto)
  status!: ProviderStatusDto;
}
