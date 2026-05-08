import { IsEnum, IsInt, IsDateString, IsPositive } from 'class-validator';
import { ActivityType, ActivityIntensity } from '@prisma/client';

export class CreateActivityEntryDto {
  @IsEnum(ActivityType)
  type!: ActivityType;

  @IsEnum(ActivityIntensity)
  intensity!: ActivityIntensity;

  @IsInt()
  @IsPositive()
  duration!: number;

  @IsDateString()
  date!: string;
}
