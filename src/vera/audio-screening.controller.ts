import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AudioScreeningService } from './audio-screening.service';
import { ScreenAudioChunkDto } from './dto/screen-audio-chunk.dto';
import {
  MAX_EVIDENCE_UPLOAD_BYTES,
  type UploadedEvidenceFile,
} from './evidence.service';

@UseGuards(JwtGuard)
@Controller('vera/audio-screening')
export class AudioScreeningController {
  constructor(private readonly audioScreeningService: AudioScreeningService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_EVIDENCE_UPLOAD_BYTES },
    }),
  )
  screen(
    @CurrentUser() user: { sub: string },
    @Body() dto: ScreenAudioChunkDto,
    @UploadedFile() file?: UploadedEvidenceFile,
  ) {
    return this.audioScreeningService.screen(user.sub, dto, file);
  }
}
