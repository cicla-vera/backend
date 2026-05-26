import { IsOptional, IsString } from 'class-validator';

export class SendTestNotificationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
