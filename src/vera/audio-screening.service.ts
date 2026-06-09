import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
} from '@prisma/client';
import {
  AiServiceClient,
  type AnalyzeEvidenceCaptureContext,
  type AnalyzeEvidenceResponse,
} from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenAudioChunkDto } from './dto/screen-audio-chunk.dto';
import { EmergencyDispatchService } from './emergency-dispatch.service';
import { type UploadedEvidenceFile } from './evidence.service';

type AudioScreeningDispatchResponse = Awaited<
  ReturnType<EmergencyDispatchService['dispatchCriticalAlert']>
>;

type AudioScreeningResponse = {
  analysis: AnalyzeEvidenceResponse;
  alertSessionId: string | null;
  emergencyDispatch: AudioScreeningDispatchResponse | null;
  persistReasons: string[];
  shouldPersistEvidence: boolean;
};

const PERSISTABLE_RISK_LEVELS = new Set(['MEDIUM', 'HIGH', 'CRITICAL']);

@Injectable()
export class AudioScreeningService {
  constructor(
    private prisma: PrismaService,
    private aiServiceClient: AiServiceClient,
    private emergencyDispatchService: EmergencyDispatchService,
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
    const criticalDispatch = await this.dispatchCriticalScreeningIfNeeded(
      userId,
      dto,
      metadata,
      analysis,
    );

    return {
      analysis,
      alertSessionId:
        criticalDispatch?.alertSessionId ?? dto.alertSessionId ?? null,
      emergencyDispatch: criticalDispatch?.emergencyDispatch ?? null,
      persistReasons,
      shouldPersistEvidence: persistReasons.length > 0,
    };
  }

  private async dispatchCriticalScreeningIfNeeded(
    userId: string,
    dto: ScreenAudioChunkDto,
    metadata: Record<string, unknown>,
    analysis: AnalyzeEvidenceResponse,
  ): Promise<{
    alertSessionId: string;
    emergencyDispatch: AudioScreeningDispatchResponse;
  } | null> {
    if (!this.shouldDispatchCriticalScreening(analysis)) {
      return null;
    }

    const alertSessionId = await this.persistCriticalScreeningSession(
      userId,
      dto,
      metadata,
      analysis,
    );
    const emergencyDispatch =
      await this.emergencyDispatchService.dispatchCriticalAlert(
        userId,
        alertSessionId,
        { source: 'ai_escalation' },
      );

    return { alertSessionId, emergencyDispatch };
  }

  private async persistCriticalScreeningSession(
    userId: string,
    dto: ScreenAudioChunkDto,
    metadata: Record<string, unknown>,
    analysis: AnalyzeEvidenceResponse,
  ): Promise<string> {
    const now = new Date();
    const location = this.getValidCoordinatePair(metadata);
    const screeningMetadata = this.buildCriticalScreeningMetadata(analysis);

    return this.prisma.$transaction(async (tx) => {
      const existingSession = dto.alertSessionId
        ? await tx.alertSession.findFirst({
            where: { id: dto.alertSessionId, userId },
          })
        : await tx.alertSession.findFirst({
            where: { userId, status: AlertStatus.ACTIVE },
            orderBy: { startedAt: 'desc' },
          });

      if (existingSession) {
        const wasCritical = existingSession.level === AlertLevel.CRITICAL;

        if (!wasCritical) {
          await tx.alertSession.update({
            where: { id: existingSession.id },
            data: {
              level: AlertLevel.CRITICAL,
              criticalEscalatedAt: existingSession.criticalEscalatedAt ?? now,
            },
          });
        }

        await tx.alertEvent.create({
          data: {
            userId,
            alertSessionId: existingSession.id,
            type: AlertEventType.AI_ANALYSIS_COMPLETED,
            message: 'Audio screening AI analysis completed.',
            metadata: screeningMetadata,
            latitude: location?.latitude,
            longitude: location?.longitude,
          },
        });

        if (!wasCritical) {
          await tx.alertEvent.create({
            data: {
              userId,
              alertSessionId: existingSession.id,
              type: AlertEventType.ALERT_ESCALATED,
              message: 'Audio screening escalated the alert to critical.',
              metadata: {
                ...screeningMetadata,
                escalationSource: 'audio_screening',
              },
              latitude: location?.latitude,
              longitude: location?.longitude,
            },
          });
        }

        return existingSession.id;
      }

      const created = await tx.alertSession.create({
        data: {
          userId,
          trigger: AlertTrigger.MANUAL,
          level: AlertLevel.CRITICAL,
          criticalEscalatedAt: now,
          initialLatitude: location?.latitude,
          initialLongitude: location?.longitude,
          events: {
            create: [
              {
                userId,
                type: AlertEventType.SESSION_STARTED,
                message:
                  'Audio screening created a critical Vera alert session.',
                metadata: { source: 'audio_screening' },
                latitude: location?.latitude,
                longitude: location?.longitude,
              },
              {
                userId,
                type: AlertEventType.AI_ANALYSIS_COMPLETED,
                message: 'Audio screening AI analysis completed.',
                metadata: screeningMetadata,
                latitude: location?.latitude,
                longitude: location?.longitude,
              },
              {
                userId,
                type: AlertEventType.ALERT_ESCALATED,
                message: 'Audio screening escalated the alert to critical.',
                metadata: {
                  ...screeningMetadata,
                  escalationSource: 'audio_screening',
                },
                latitude: location?.latitude,
                longitude: location?.longitude,
              },
            ],
          },
        },
        select: { id: true },
      });

      return created.id;
    });
  }

  private shouldDispatchCriticalScreening(
    analysis: AnalyzeEvidenceResponse,
  ): boolean {
    if (analysis.status === 'FAILED') {
      return false;
    }

    return (
      analysis.riskLevel === 'CRITICAL' ||
      analysis.shouldEscalate ||
      this.normalizeAction(analysis.recommendedAction) === 'escalate_contacts'
    );
  }

  private buildCriticalScreeningMetadata(
    analysis: AnalyzeEvidenceResponse,
  ): Record<string, string | number | boolean | null> {
    return {
      source: 'audio_screening',
      analysisId: analysis.analysisId,
      analysisVersion: analysis.analysisVersion,
      status: analysis.status,
      riskLevel: analysis.riskLevel,
      confidence: analysis.confidence,
      shouldEscalate: analysis.shouldEscalate,
      recommendedAction: analysis.recommendedAction,
      summary: analysis.summary,
      failureReason: analysis.failureReason,
      transcriptionText: this.getTranscriptionText(analysis.transcription),
      detectedSignals: analysis.detectedSignals.join(','),
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
    const location = this.getValidCoordinatePair(metadata);

    if (!location) {
      return undefined;
    }

    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: this.getNumber(metadata, 'accuracyMeters'),
      capturedAt: this.getString(metadata, 'capturedAt'),
    };
  }

  private getValidCoordinatePair(
    metadata: Record<string, unknown>,
  ): { latitude: number; longitude: number } | null {
    const latitude = this.getNumber(metadata, 'latitude');
    const longitude = this.getNumber(metadata, 'longitude');

    if (
      latitude === undefined ||
      longitude === undefined ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }

    return { latitude, longitude };
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

  private normalizeAction(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? '';
  }

  private getTranscriptionText(
    transcription: Record<string, unknown> | null,
  ): string | null {
    if (!transcription) {
      return null;
    }

    const directText = transcription.text;

    if (typeof directText === 'string' && directText.trim()) {
      return directText.trim();
    }

    const segments = transcription.segments;

    if (!Array.isArray(segments)) {
      return null;
    }

    const text = segments
      .map((segment) => {
        if (!segment || typeof segment !== 'object') {
          return null;
        }

        const segmentText = (segment as Record<string, unknown>).text;
        return typeof segmentText === 'string' ? segmentText.trim() : null;
      })
      .filter(Boolean)
      .join(' ')
      .trim();

    return text || null;
  }
}
