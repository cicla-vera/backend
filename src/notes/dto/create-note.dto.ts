import { IsDateString, IsString } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  content!: string;

  @IsDateString()
  date!: string;
}
