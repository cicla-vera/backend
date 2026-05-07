import { IsDateString, IsOptional } from 'class-validator';

export class CreateCycleDto {
  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
