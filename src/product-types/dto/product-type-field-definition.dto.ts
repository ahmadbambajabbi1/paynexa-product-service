import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class ProductTypeFieldDefinitionDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,63}$/)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsString()
  @IsIn([
    'string',
    'number',
    'boolean',
    'date',
    'email',
    'url',
    'text',
    'image',
  ])
  valueType!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}
