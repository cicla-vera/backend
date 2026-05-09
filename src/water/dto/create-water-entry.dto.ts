import { IsInt, IsDateString, IsPositive, Max } from 'class-validator';

export class CreateWaterEntryDto {
  @IsInt()
  @IsPositive()
  @Max(5000)
  amount!: number;

  @IsDateString()
  date!: string;
}
