import { AlertEventType } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

type AlertEventMetadataValue = string | number | boolean | null;

export class CreateAlertEventDto {
  @IsEnum(AlertEventType)
  type!: AlertEventType;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  message?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, AlertEventMetadataValue>;

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
}
