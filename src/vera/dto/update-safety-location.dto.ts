import { SafetyLocationType } from '@prisma/client';
import {
  IsBoolean,
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

export class UpdateSafetyLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(25)
  @Max(10000)
  radiusMeters?: number;

  @IsOptional()
  @IsEnum(SafetyLocationType)
  type?: SafetyLocationType;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
