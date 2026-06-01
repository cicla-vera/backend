import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LocationSampleSource } from '@prisma/client';

export class LocationSampleDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsISO8601()
  capturedAt!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracyMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(-500)
  @Max(10000)
  altitudeMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  speedMetersPerSecond?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;

  @IsOptional()
  @IsEnum(LocationSampleSource)
  source?: LocationSampleSource;

  @IsOptional()
  @IsUUID()
  evidenceRecordId?: string;
}

export class RecordLocationSamplesDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LocationSampleDto)
  samples?: LocationSampleDto[];

  @ValidateIf((dto: RecordLocationSamplesDto) => !dto.samples)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ValidateIf((dto: RecordLocationSamplesDto) => !dto.samples)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ValidateIf((dto: RecordLocationSamplesDto) => !dto.samples)
  @IsISO8601()
  capturedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracyMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(-500)
  @Max(10000)
  altitudeMeters?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  speedMetersPerSecond?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;

  @IsOptional()
  @IsEnum(LocationSampleSource)
  source?: LocationSampleSource;

  @IsOptional()
  @IsUUID()
  evidenceRecordId?: string;
}
