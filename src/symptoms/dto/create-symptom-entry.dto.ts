import {
  IsString,
  IsDateString,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class CreateSymptomEntryDto {
  @IsString()
  symptomName!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  intensity?: number;
}
