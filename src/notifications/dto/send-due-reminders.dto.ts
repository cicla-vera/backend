import { IsDateString, IsOptional } from 'class-validator';

export class SendDueRemindersDto {
  @IsOptional()
  @IsDateString()
  referenceDate?: string;
}
