import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ScreenAudioChunkDto {
  @IsOptional()
  @IsUUID()
  alertSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  metadata?: string;
}
