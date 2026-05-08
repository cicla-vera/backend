import { IsBoolean, IsDateString } from 'class-validator';

export class CreateIntercourseEntryDto {
  @IsBoolean()
  protected!: boolean;

  @IsDateString()
  date!: string;
}
