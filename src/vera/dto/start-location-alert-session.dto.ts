import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StartLocationAlertSessionDto {
  @IsUUID()
  safetyLocationId!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  currentLatitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  currentLongitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  message?: string;
}
