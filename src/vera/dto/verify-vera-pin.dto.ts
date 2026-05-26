import { Matches } from 'class-validator';

const PIN_PATTERN = /^\d{4,8}$/;

export class VerifyVeraPinDto {
  @Matches(PIN_PATTERN)
  pin!: string;
}
