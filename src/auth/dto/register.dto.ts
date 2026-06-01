import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsDateString,
  ValidateNested,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class InitialCycleDataDto {
  @IsOptional()
  @IsDateString()
  lastPeriodDate?: string;

  @IsOptional()
  @IsInt()
  @Min(20)
  avgCycleLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  avgPeriodDuration?: number;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  name!: string;

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
  @ValidateNested()
  @Type(() => InitialCycleDataDto)
  initialCycleData?: InitialCycleDataDto;
}
