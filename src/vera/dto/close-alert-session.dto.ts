import { AlertStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseAlertSessionDto {
  @IsEnum(AlertStatus)
  status!: AlertStatus;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  message?: string;
}
