import { IsDateString, IsEnum } from 'class-validator';
import { FlowIntensity } from '@prisma/client';

export class CreateFlowEntryDto {
  @IsEnum(FlowIntensity)
  intensity!: FlowIntensity;

  @IsDateString()
  date!: string;
}
