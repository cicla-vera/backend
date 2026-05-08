import { IsNumber, IsDateString, IsPositive, Max } from 'class-validator';

export class CreateTemperatureEntryDto {
  @IsNumber()
  @IsPositive()
  @Max(45)
  temperature!: number;

  @IsDateString()
  date!: string;
}
