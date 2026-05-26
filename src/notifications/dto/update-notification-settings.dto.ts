import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  periodReminder?: boolean;

  @IsOptional()
  @IsBoolean()
  ovulationReminder?: boolean;

  @IsOptional()
  @IsBoolean()
  medicationReminder?: boolean;

  @IsOptional()
  @IsBoolean()
  waterReminder?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderHour?: number;
}
