import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { MoodType } from '@prisma/client';

export class CreateMoodEntryDto {
  @IsEnum(MoodType)
  mood!: MoodType;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
