import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StartManualAlertSessionDto {
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  initialLatitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  initialLongitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  message?: string;
}
