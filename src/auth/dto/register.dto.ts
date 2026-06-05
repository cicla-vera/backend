import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsDateString,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

class InitialCycleDataDto {
  @IsOptional()
  @IsDateString()
  lastPeriodDate?: string;

  @IsOptional()
  @IsDateString()
  lastPeriodEndDate?: string;

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

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
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
