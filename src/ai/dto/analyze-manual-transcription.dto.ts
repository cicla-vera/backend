import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AnalyzeManualTranscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsString()
  alertSessionId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerReasons?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  localConfidence?: number;
}
