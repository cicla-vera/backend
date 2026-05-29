import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  EvidenceAnalysisStatus,
  EvidenceType,
  Prisma,
  type EvidenceAnalysis,
  type EvidenceRecord,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  AiServiceClient,
  type AnalyzeEvidenceInput,
  type AnalyzeEvidenceResponse,
} from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceStorageService } from './evidence-storage.service';

type EvidenceAnalysisResponse = {
  id: string;
  analysisId: string | null;
  analysisVersion: string | null;
  evidenceRecordId: string;
  alertSessionId: string;
  status: EvidenceAnalysisStatus;
  riskLevel: string | null;
  suggestedAlertLevel: AlertLevel | null;
  confidence: number | null;
  summary: string | null;
  detectedSignals: unknown;
  shouldEscalate: boolean | null;
  recommendedAction: string | null;
  evidenceWindow: unknown;
  transcription: unknown;
  acousticEvents: unknown;
  threatMatches: unknown;
  providerMetadata: unknown;
  processingStartedAt: Date | null;
  processingFinishedAt: Date | null;
  latencyMs: number | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class EvidenceAnalysisService {
  constructor(
    private prisma: PrismaService,
    private aiServiceClient: AiServiceClient,
    private evidenceStorage: EvidenceStorageService,
  ) {}

  async analyze(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceAnalysisResponse> {
    const evidenceRecord = await this.findUserVisibleEvidence(
      userId,
      alertSessionId,
      evidenceRecordId,
    );
    this.assertAudioEvidence(evidenceRecord);

    const analysis = await this.createQueuedAnalysis(userId, evidenceRecord);
    await this.markProcessing(analysis.id);

    try {
      const input = await this.buildAnalyzeEvidenceInput(evidenceRecord);
      const aiResult = await this.aiServiceClient.analyzeEvidence(input);

      return this.persistAiResult(
        userId,
        evidenceRecord,
        analysis.id,
        aiResult,
      );
    } catch (error) {
      return this.persistFailedAnalysis(
        userId,
        evidenceRecord,
        analysis.id,
        this.getSafeFailureReason(error),
      );
    }
  }

  async findLatest(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceAnalysisResponse | null> {
    await this.findUserVisibleEvidence(
      userId,
      alertSessionId,
      evidenceRecordId,
    );

    const analysis = await this.prisma.evidenceAnalysis.findFirst({
      where: {
        userId,
        alertSessionId,
        evidenceRecordId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return analysis ? this.toResponse(analysis) : null;
  }

  private async findUserVisibleEvidence(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceRecord> {
    const evidenceRecord = await this.prisma.evidenceRecord.findFirst({
      where: {
        id: evidenceRecordId,
        userId,
        alertSessionId,
        hiddenFromUserAt: null,
        deletedAt: null,
      },
    });

    if (!evidenceRecord) {
      throw new NotFoundException('Evidence record not found');
    }

    return evidenceRecord;
  }

  private async createQueuedAnalysis(
    userId: string,
    evidenceRecord: EvidenceRecord,
  ): Promise<EvidenceAnalysis> {
    return this.prisma.evidenceAnalysis.create({
      data: {
        userId,
        alertSessionId: evidenceRecord.alertSessionId,
        evidenceRecordId: evidenceRecord.id,
        status: EvidenceAnalysisStatus.QUEUED,
      },
    });
  }

  private async markProcessing(evidenceAnalysisId: string): Promise<void> {
    await this.prisma.evidenceAnalysis.update({
      where: { id: evidenceAnalysisId },
      data: { status: EvidenceAnalysisStatus.PROCESSING },
    });
  }

  private async buildAnalyzeEvidenceInput(
    evidenceRecord: EvidenceRecord,
  ): Promise<AnalyzeEvidenceInput> {
    const download = await this.evidenceStorage.downloadEvidence(
      evidenceRecord.storagePath,
    );
    const body = Buffer.from(download.body);
    const contentHash = this.calculateContentHash(body);

    if (contentHash !== evidenceRecord.contentHash) {
      throw new EvidenceAnalysisError('stored_content_hash_mismatch');
    }

    return {
      evidenceRecordId: evidenceRecord.id,
      alertSessionId: evidenceRecord.alertSessionId,
      evidenceType: evidenceRecord.type,
      mimeType: evidenceRecord.mimeType,
      size: body.byteLength,
      contentHash,
      storageReference: this.buildDataUrl(evidenceRecord.mimeType, body),
      captureContext: this.getCaptureContext(evidenceRecord.metadata),
    };
  }

  private async persistAiResult(
    userId: string,
    evidenceRecord: EvidenceRecord,
    evidenceAnalysisId: string,
    aiResult: AnalyzeEvidenceResponse,
  ): Promise<EvidenceAnalysisResponse> {
    const status = this.getPersistedStatus(aiResult);
    const suggestedAlertLevel = this.getSuggestedAlertLevel(aiResult);
    const analysis = await this.prisma.$transaction(async (tx) => {
      const evidenceAnalysis = await tx.evidenceAnalysis.update({
        where: { id: evidenceAnalysisId },
        data: this.buildAiResultData(status, suggestedAlertLevel, aiResult),
      });

      await tx.alertEvent.create({
        data: {
          userId,
          alertSessionId: evidenceRecord.alertSessionId,
          type: AlertEventType.AI_ANALYSIS_COMPLETED,
          message: this.getAnalysisEventMessage(status),
          metadata: {
            status: evidenceAnalysis.status,
            evidenceAnalysisId: evidenceAnalysis.id,
            evidenceRecordId: evidenceRecord.id,
            riskLevel: evidenceAnalysis.riskLevel,
            confidence: evidenceAnalysis.confidence,
            shouldEscalate: evidenceAnalysis.shouldEscalate,
            recommendedAction: evidenceAnalysis.recommendedAction,
            suggestedAlertLevel,
            failureReason: evidenceAnalysis.failureReason,
            provider: this.getProviderName(aiResult.providerMetadata),
          },
        },
      });

      return evidenceAnalysis;
    });

    return this.toResponse(analysis);
  }

  private async persistFailedAnalysis(
    userId: string,
    evidenceRecord: EvidenceRecord,
    evidenceAnalysisId: string,
    failureReason: string,
  ): Promise<EvidenceAnalysisResponse> {
    const analysis = await this.prisma.$transaction(async (tx) => {
      const evidenceAnalysis = await tx.evidenceAnalysis.update({
        where: { id: evidenceAnalysisId },
        data: {
          status: EvidenceAnalysisStatus.FAILED,
          failureReason,
        },
      });

      await tx.alertEvent.create({
        data: {
          userId,
          alertSessionId: evidenceRecord.alertSessionId,
          type: AlertEventType.AI_ANALYSIS_COMPLETED,
          message: 'AI analysis failed.',
          metadata: {
            status: evidenceAnalysis.status,
            evidenceAnalysisId: evidenceAnalysis.id,
            evidenceRecordId: evidenceRecord.id,
            failureReason,
          },
        },
      });

      return evidenceAnalysis;
    });

    return this.toResponse(analysis);
  }

  private getSuggestedAlertLevel(
    aiResult: AnalyzeEvidenceResponse,
  ): AlertLevel {
    if (aiResult.shouldEscalate || aiResult.riskLevel === 'CRITICAL') {
      return AlertLevel.CRITICAL;
    }

    return AlertLevel.NORMAL;
  }

  private getPersistedStatus(
    aiResult: AnalyzeEvidenceResponse,
  ): EvidenceAnalysisStatus {
    if (aiResult.status === 'FAILED') {
      return EvidenceAnalysisStatus.FAILED;
    }

    if (aiResult.status === 'INCONCLUSIVE') {
      return EvidenceAnalysisStatus.INCONCLUSIVE;
    }

    if (aiResult.status === 'QUEUED') {
      return EvidenceAnalysisStatus.QUEUED;
    }

    if (aiResult.status === 'PROCESSING') {
      return EvidenceAnalysisStatus.PROCESSING;
    }

    return EvidenceAnalysisStatus.COMPLETED;
  }

  private buildAiResultData(
    status: EvidenceAnalysisStatus,
    suggestedAlertLevel: AlertLevel,
    aiResult: AnalyzeEvidenceResponse,
  ): Prisma.EvidenceAnalysisUpdateInput {
    return {
      analysisId: aiResult.analysisId,
      analysisVersion: aiResult.analysisVersion,
      status,
      riskLevel: aiResult.riskLevel,
      suggestedAlertLevel,
      confidence: aiResult.confidence,
      summary: aiResult.summary,
      detectedSignals: this.toJsonInput(aiResult.detectedSignals),
      shouldEscalate: aiResult.shouldEscalate,
      recommendedAction: aiResult.recommendedAction,
      evidenceWindow: this.toJsonInput(aiResult.evidenceWindow),
      transcription: this.toNullableJsonInput(aiResult.transcription),
      acousticEvents: this.toJsonInput(aiResult.acousticEvents),
      threatMatches: this.toJsonInput(aiResult.threatMatches),
      providerMetadata: this.toJsonInput(aiResult.providerMetadata),
      processingStartedAt: this.parseDate(aiResult.processingStartedAt),
      processingFinishedAt: this.parseDate(aiResult.processingFinishedAt),
      latencyMs: aiResult.latencyMs,
      failureReason:
        status === EvidenceAnalysisStatus.FAILED
          ? (aiResult.failureReason ?? 'ai_service_failed')
          : aiResult.failureReason,
    };
  }

  private getAnalysisEventMessage(status: EvidenceAnalysisStatus): string {
    if (status === EvidenceAnalysisStatus.QUEUED) {
      return 'AI analysis queued.';
    }

    if (status === EvidenceAnalysisStatus.PROCESSING) {
      return 'AI analysis processing.';
    }

    if (status === EvidenceAnalysisStatus.FAILED) {
      return 'AI analysis failed.';
    }

    if (status === EvidenceAnalysisStatus.INCONCLUSIVE) {
      return 'AI analysis inconclusive.';
    }

    return 'AI analysis completed.';
  }

  private getSafeFailureReason(error: unknown): string {
    if (error instanceof EvidenceAnalysisError) {
      return error.code;
    }

    if (error instanceof HttpException) {
      return `ai_service_http_${error.getStatus()}`;
    }

    return 'ai_service_failed';
  }

  private toResponse(analysis: EvidenceAnalysis): EvidenceAnalysisResponse {
    return {
      id: analysis.id,
      analysisId: analysis.analysisId,
      analysisVersion: analysis.analysisVersion,
      evidenceRecordId: analysis.evidenceRecordId,
      alertSessionId: analysis.alertSessionId,
      status: analysis.status,
      riskLevel: analysis.riskLevel,
      suggestedAlertLevel: analysis.suggestedAlertLevel,
      confidence: analysis.confidence,
      summary: analysis.summary,
      detectedSignals: analysis.detectedSignals,
      shouldEscalate: analysis.shouldEscalate,
      recommendedAction: analysis.recommendedAction,
      evidenceWindow: analysis.evidenceWindow,
      transcription: analysis.transcription,
      acousticEvents: analysis.acousticEvents,
      threatMatches: analysis.threatMatches,
      providerMetadata: analysis.providerMetadata,
      processingStartedAt: analysis.processingStartedAt,
      processingFinishedAt: analysis.processingFinishedAt,
      latencyMs: analysis.latencyMs,
      failureReason: analysis.failureReason,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  }

  private assertAudioEvidence(evidenceRecord: EvidenceRecord): void {
    if (evidenceRecord.type !== EvidenceType.AUDIO) {
      throw new BadRequestException('Only audio evidence can be analyzed.');
    }
  }

  private buildDataUrl(mimeType: string, body: Buffer): string {
    return `data:${mimeType};base64,${body.toString('base64')}`;
  }

  private calculateContentHash(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }

  private getCaptureContext(
    metadata: Prisma.JsonValue | null,
  ): AnalyzeEvidenceInput['captureContext'] | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }

    const values = metadata as Record<string, unknown>;
    const context: NonNullable<AnalyzeEvidenceInput['captureContext']> = {};
    const captureStartedAt = this.getMetadataString(values, 'captureStartedAt');
    const captureEndedAt = this.getMetadataString(values, 'captureEndedAt');
    const triggeredAt = this.getMetadataString(values, 'triggeredAt');
    const preRollMs = this.getMetadataNumber(values, 'preRollMs');
    const postRollMs = this.getMetadataNumber(values, 'postRollMs');
    const triggerReasons = this.getMetadataStringArray(
      values,
      'triggerReasons',
    );
    const localConfidence = this.getMetadataNumber(values, 'localConfidence');
    const platform = this.getMetadataString(values, 'platform');
    const foreground = this.getMetadataBoolean(values, 'foreground');
    const location = this.getCaptureLocation(values);

    if (captureStartedAt) {
      context.captureStartedAt = captureStartedAt;
    }

    if (captureEndedAt) {
      context.captureEndedAt = captureEndedAt;
    }

    if (triggeredAt) {
      context.triggeredAt = triggeredAt;
    }

    if (preRollMs !== undefined) {
      context.preRollMs = preRollMs;
    }

    if (postRollMs !== undefined) {
      context.postRollMs = postRollMs;
    }

    if (triggerReasons.length > 0) {
      context.triggerReasons = triggerReasons;
    }

    if (localConfidence !== undefined) {
      context.localConfidence = localConfidence;
    }

    if (platform) {
      context.platform = platform;
    }

    if (foreground !== undefined) {
      context.foreground = foreground;
    }

    if (location) {
      context.location = location;
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  private getCaptureLocation(
    values: Record<string, unknown>,
  ):
    | NonNullable<AnalyzeEvidenceInput['captureContext']>['location']
    | undefined {
    const latitude = this.getMetadataNumber(values, 'latitude');
    const longitude = this.getMetadataNumber(values, 'longitude');

    if (latitude === undefined || longitude === undefined) {
      return undefined;
    }

    const location: NonNullable<
      NonNullable<AnalyzeEvidenceInput['captureContext']>['location']
    > = {
      latitude,
      longitude,
    };
    const accuracyMeters = this.getMetadataNumber(values, 'accuracyMeters');
    const capturedAt = this.getMetadataString(values, 'capturedAt');

    if (accuracyMeters !== undefined) {
      location.accuracyMeters = accuracyMeters;
    }

    if (capturedAt) {
      location.capturedAt = capturedAt;
    }

    return location;
  }

  private getMetadataString(
    values: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = values[key];

    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private getMetadataNumber(
    values: Record<string, unknown>,
    key: string,
  ): number | undefined {
    const value = values[key];

    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private getMetadataBoolean(
    values: Record<string, unknown>,
    key: string,
  ): boolean | undefined {
    const value = values[key];

    return typeof value === 'boolean' ? value : undefined;
  }

  private getMetadataStringArray(
    values: Record<string, unknown>,
    key: string,
  ): string[] {
    const value = values[key];

    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private toNullableJsonInput(
    value: unknown,
  ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }

  private parseDate(value: string): Date | undefined {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private getProviderName(
    providerMetadata: Record<string, unknown>,
  ): string | null {
    const provider = providerMetadata.provider;

    return typeof provider === 'string' ? provider : null;
  }
}

class EvidenceAnalysisError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
