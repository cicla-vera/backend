import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AiServiceClient } from './ai-service.client';
import { AnalyzeManualTranscriptionDto } from './dto/analyze-manual-transcription.dto';

@UseGuards(JwtGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiServiceClient: AiServiceClient) {}

  @Post('manual-transcription/analyze')
  analyzeManualTranscription(
    @CurrentUser() user: { sub: string },
    @Body() dto: AnalyzeManualTranscriptionDto,
  ) {
    const text = dto.text.trim();
    const textBuffer = Buffer.from(text, 'utf8');
    const now = new Date().toISOString();

    return this.aiServiceClient.analyzeEvidence({
      evidenceRecordId: `manual-transcription-${Date.now()}`,
      alertSessionId: dto.alertSessionId ?? `manual-test-${user.sub}`,
      evidenceType: 'AUDIO',
      mimeType: 'audio/manual',
      size: Math.max(1, textBuffer.byteLength),
      contentHash: createHash('sha256').update(textBuffer).digest('hex'),
      captureContext: {
        captureStartedAt: now,
        captureEndedAt: now,
        triggeredAt: now,
        triggerReasons: [
          'manual_transcription_test',
          ...(dto.triggerReasons ?? []),
        ],
        localConfidence: dto.localConfidence ?? 1,
        platform: 'manual-test',
        foreground: true,
      },
      manualTranscriptionText: text,
    });
  }
}
