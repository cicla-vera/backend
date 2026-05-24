import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSafetyProfileDto {
  @IsOptional()
  @IsBoolean()
  veraEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  consentAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  biometricUnlockEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  discreetNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  monitoringEnabled?: boolean;
}
