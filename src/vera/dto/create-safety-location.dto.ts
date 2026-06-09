import { SafetyLocationType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSafetyLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsInt()
  @Min(25)
  @Max(10000)
  radiusMeters?: number;

  @IsOptional()
  @IsEnum(SafetyLocationType)
  type?: SafetyLocationType;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  formattedAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  placeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  addressSource?: string;
}
