import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UploadEvidenceDto } from './dto/upload-evidence.dto';
import {
  EvidenceService,
  MAX_EVIDENCE_UPLOAD_BYTES,
  type UploadedEvidenceFile,
} from './evidence.service';
import { EvidenceAnalysisService } from './evidence-analysis.service';

@UseGuards(JwtGuard)
@Controller('vera/alert-sessions/:alertSessionId/evidence')
export class EvidenceController {
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly evidenceAnalysisService: EvidenceAnalysisService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
  ) {
    return this.evidenceService.findAll(user.sub, alertSessionId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_EVIDENCE_UPLOAD_BYTES },
    }),
  )
  upload(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
    @Body() dto: UploadEvidenceDto,
    @UploadedFile() file?: UploadedEvidenceFile,
  ) {
    return this.evidenceService.upload(user.sub, alertSessionId, dto, file);
  }

  @Post(':id/verify')
  verify(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
    @Param('id') id: string,
  ) {
    return this.evidenceService.verify(user.sub, alertSessionId, id);
  }

  @Post(':id/analyze')
  analyze(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
    @Param('id') id: string,
  ) {
    return this.evidenceAnalysisService.analyze(user.sub, alertSessionId, id);
  }

  @Delete(':id')
  hideFromUser(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
    @Param('id') id: string,
  ) {
    return this.evidenceService.hideFromUser(user.sub, alertSessionId, id);
  }
}
