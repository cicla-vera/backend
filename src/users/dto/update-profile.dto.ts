import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(50)
  avgCycleLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  avgPeriodDuration?: number;
}
