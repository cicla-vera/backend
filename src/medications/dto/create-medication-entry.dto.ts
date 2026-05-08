import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateMedicationEntryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  dose?: string;

  @IsDateString()
  date!: string;
}
