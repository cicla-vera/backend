import { IsOptional, Matches } from 'class-validator';

const PIN_PATTERN = /^\d{4,8}$/;

export class SetVeraPinDto {
  @Matches(PIN_PATTERN)
  pin!: string;

  @IsOptional()
  @Matches(PIN_PATTERN)
  currentPin?: string;
}
