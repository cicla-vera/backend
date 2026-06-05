import { IsString, Length, Matches } from 'class-validator';

export class ConfirmAccountVerificationDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
