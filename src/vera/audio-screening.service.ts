import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  AiServiceClient,
  type AnalyzeEvidenceCaptureContext,
  type AnalyzeEvidenceResponse,
} from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenAudioChunkDto } from './dto/screen-audio-chunk.dto';
import { type UploadedEvidenceFile } from './evidence.service';

type AudioScreeningResponse = {
  analysis: AnalyzeEvidenceResponse;
  persistReasons: string[];
  shouldPersistEvidence: boolean;
};

const PERSISTABLE_RISK_LEVELS = new Set(['MEDIUM', 'HIGH', 'CRITICAL']);

@Injectable()
export class AudioScreeningService {
  constructor(
    private prisma: PrismaService,
    private aiServiceClient: AiServiceClient,
  ) {}

  async screen(
    userId: string,
    dto: ScreenAudioChunkDto,
    file?: UploadedEvidenceFile,
  ): Promise<AudioScreeningResponse> {
    if (!file) {
      throw new BadRequestException('Audio file is required.');
    }

    if (!file.mimetype.startsWith('audio/')) {
      throw new BadRequestException('Only audio files can be screened.');
    }

    if (dto.alertSessionId) {
      await this.assertOwnedAlertSession(userId, dto.alertSessionId);
    }

    const metadata = this.parseMetadata(dto.metadata);
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    const analysis = await this.aiServiceClient.analyzeEvidence({
      evidenceRecordId: `audio-screening-${randomUUID()}`,
      alertSessionId: dto.alertSessionId ?? `audio-screening-${userId}`,
      evidenceType: 'AUDIO',
      mimeType: file.mimetype,
      size: file.size,
      contentHash,
      storageReference: this.toDataUrl(file),
      captureContext: this.buildCaptureContext(metadata),
    });
    const persistReasons = this.getPersistReasons(analysis);

    return {
      analysis,
      persistReasons,
      shouldPersistEvidence: persistReasons.length > 0,
    };
  }

  private async assertOwnedAlertSession(
    userId: string,
    alertSessionId: string,
  ): Promise<void> {
    const session = await this.prisma.alertSession.findFirst({
      where: { id: alertSessionId, userId },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException('Alert session not found');
    }
  }

  private parseMetadata(value?: string): Record<string, unknown> {
    if (!value) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(value);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private buildCaptureContext(
    metadata: Record<string, unknown>,
  ): AnalyzeEvidenceCaptureContext {
    const location = this.getLocation(metadata);

    return {
      captureStartedAt: this.getString(metadata, 'captureStartedAt'),
      captureEndedAt: this.getString(metadata, 'captureEndedAt'),
      triggeredAt: this.getString(metadata, 'triggeredAt'),
      preRollMs: this.getNumber(metadata, 'preRollMs'),
      postRollMs: this.getNumber(metadata, 'postRollMs'),
      triggerReasons: this.getString(metadata, 'triggerReasons')
        ?.split(',')
        .map((reason) => reason.trim())
        .filter(Boolean),
      localConfidence: this.getNumber(metadata, 'audioSentinelConfidence'),
      platform: this.getString(metadata, 'platform'),
      foreground: this.getBoolean(metadata, 'foreground'),
      location,
    };
  }

  private getPersistReasons(analysis: AnalyzeEvidenceResponse): string[] {
    const reasons: string[] = [];

    if (PERSISTABLE_RISK_LEVELS.has(analysis.riskLevel)) {
      reasons.push(`risk_${analysis.riskLevel.toLowerCase()}`);
    }

    if (analysis.shouldEscalate) {
      reasons.push('ai_escalation');
    }

    if (analysis.threatMatches.length > 0) {
      reasons.push('threat_match');
    }

    if (analysis.acousticEvents.length > 0) {
      reasons.push('acoustic_event_review');
    }

    if (
      analysis.recommendedAction &&
      analysis.recommendedAction !== 'NONE' &&
      analysis.recommendedAction !== 'IGNORE'
    ) {
      reasons.push('recommended_action');
    }

    return [...new Set(reasons)];
  }

  private toDataUrl(file: UploadedEvidenceFile) {
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  }

  private getLocation(
    metadata: Record<string, unknown>,
  ): AnalyzeEvidenceCaptureContext['location'] | undefined {
    const latitude = this.getNumber(metadata, 'latitude');
    const longitude = this.getNumber(metadata, 'longitude');

    if (latitude === undefined || longitude === undefined) {
      return undefined;
    }

    return {
      latitude,
      longitude,
      accuracyMeters: this.getNumber(metadata, 'accuracyMeters'),
      capturedAt: this.getString(metadata, 'capturedAt'),
    };
  }

  private getString(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];

    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private getNumber(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];

    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private getBoolean(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];

    return typeof value === 'boolean' ? value : undefined;
  }
}
