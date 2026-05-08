import { IsNumber, IsDateString, IsPositive } from 'class-validator';

export class CreateWeightEntryDto {
  @IsNumber()
  @IsPositive()
  weight!: number;

  @IsDateString()
  date!: string;
}
