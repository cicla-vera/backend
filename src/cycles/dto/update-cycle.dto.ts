import { IsDateString, IsOptional } from 'class-validator';

export class UpdateCycleDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}
