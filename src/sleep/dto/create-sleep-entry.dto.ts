import { SleepQuality } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsPositive,
  Max,
} from 'class-validator';

export class CreateSleepEntryDto {
  @IsNumber()
  @IsPositive()
  @Max(24)
  hours!: number;

  @IsEnum(SleepQuality)
  quality!: SleepQuality;

  @IsDateString()
  date!: string;
}
