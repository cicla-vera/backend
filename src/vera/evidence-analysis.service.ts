import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
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
import { EmergencyDispatchService } from './emergency-dispatch.service';
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

type CriticalEscalationPolicyConfig = {
  acousticConfidenceThreshold: number;
  confidenceThreshold: number;
  minSignalReasons: number;
  recurrenceMinPrevious: number;
  recurrenceWindowMs: number;
  threatConfidenceThreshold: number;
};

type CriticalEscalationDecision = {
  shouldEscalate: boolean;
  reasons: string[];
  recentHighSignalCount: number;
  policy: CriticalEscalationPolicyConfig;
};

const CRITICAL_ESCALATION_POLICY_VERSION = 'vera-ai-critical-v1';
const DEFAULT_CRITICAL_CONFIDENCE_THRESHOLD = 0.78;
const DEFAULT_CRITICAL_THREAT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_CRITICAL_ACOUSTIC_CONFIDENCE_THRESHOLD = 0.72;
const DEFAULT_CRITICAL_MIN_SIGNAL_REASONS = 2;
const DEFAULT_CRITICAL_RECURRENCE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CRITICAL_RECURRENCE_MIN_PREVIOUS = 1;

@Injectable()
export class EvidenceAnalysisService {
  constructor(
    private prisma: PrismaService,
    private aiServiceClient: AiServiceClient,
    private evidenceStorage: EvidenceStorageService,
    private emergencyDispatchService: EmergencyDispatchService,
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
    let shouldDispatchCriticalContacts = false;
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

      const criticalDecision = await this.evaluateCriticalEscalation(tx, {
        aiResult,
        evidenceAnalysis,
        evidenceRecord,
        status,
        suggestedAlertLevel,
        userId,
      });

      if (criticalDecision.shouldEscalate) {
        shouldDispatchCriticalContacts = await this.persistCriticalEscalation(
          tx,
          {
            decision: criticalDecision,
            evidenceAnalysis,
            evidenceRecord,
            userId,
          },
        );
      }

      return evidenceAnalysis;
    });

    if (shouldDispatchCriticalContacts) {
      await this.dispatchCriticalContactsSafely(
        userId,
        evidenceRecord.alertSessionId,
      );
    }

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

  private async evaluateCriticalEscalation(
    tx: Prisma.TransactionClient,
    input: {
      aiResult: AnalyzeEvidenceResponse;
      evidenceAnalysis: EvidenceAnalysis;
      evidenceRecord: EvidenceRecord;
      status: EvidenceAnalysisStatus;
      suggestedAlertLevel: AlertLevel;
      userId: string;
    },
  ): Promise<CriticalEscalationDecision> {
    const policy = this.getCriticalEscalationPolicyConfig();
    const noEscalation = (
      reasons: string[] = [],
      recentHighSignalCount = 0,
    ): CriticalEscalationDecision => ({
      shouldEscalate: false,
      reasons,
      recentHighSignalCount,
      policy,
    });

    if (
      input.status !== EvidenceAnalysisStatus.COMPLETED ||
      input.suggestedAlertLevel !== AlertLevel.CRITICAL
    ) {
      return noEscalation();
    }

    if (input.aiResult.confidence < policy.confidenceThreshold) {
      return noEscalation(['confidence_below_threshold']);
    }

    const reasons = this.collectCriticalEscalationReasons(
      input.aiResult,
      policy,
    );
    const recentHighSignalCount = await this.countRecentHighSignalAnalyses(tx, {
      evidenceAnalysis: input.evidenceAnalysis,
      evidenceRecord: input.evidenceRecord,
      policy,
      userId: input.userId,
    });

    if (recentHighSignalCount >= policy.recurrenceMinPrevious) {
      reasons.push('temporal_recurrence');
    }

    const uniqueReasons = [...new Set(reasons)];
    const hasAiEscalationIntent =
      input.aiResult.shouldEscalate ||
      this.normalize(input.aiResult.recommendedAction) === 'escalate_contacts';
    const hasDirectCriticalSignal = uniqueReasons.some((reason) =>
      [
        'concrete_threat',
        'critical_risk_level',
        'criminal_verbal_aggression',
        'physical_aggression_audio',
      ].includes(reason),
    );
    const hasEnoughSignalReasons =
      uniqueReasons.length >= policy.minSignalReasons;

    return {
      shouldEscalate:
        hasAiEscalationIntent &&
        (hasDirectCriticalSignal || hasEnoughSignalReasons),
      reasons: uniqueReasons,
      recentHighSignalCount,
      policy,
    };
  }

  private async persistCriticalEscalation(
    tx: Prisma.TransactionClient,
    input: {
      decision: CriticalEscalationDecision;
      evidenceAnalysis: EvidenceAnalysis;
      evidenceRecord: EvidenceRecord;
      userId: string;
    },
  ): Promise<boolean> {
    const updateResult = await tx.alertSession.updateMany({
      where: {
        id: input.evidenceRecord.alertSessionId,
        userId: input.userId,
        status: AlertStatus.ACTIVE,
        level: AlertLevel.NORMAL,
      },
      data: {
        level: AlertLevel.CRITICAL,
        criticalEscalatedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      return false;
    }

    await tx.alertEvent.create({
      data: {
        userId: input.userId,
        alertSessionId: input.evidenceRecord.alertSessionId,
        type: AlertEventType.ALERT_ESCALATED,
        message: 'Vera AI escalated the alert to critical.',
        metadata: {
          confidence: input.evidenceAnalysis.confidence,
          confidenceThreshold: input.decision.policy.confidenceThreshold,
          evidenceAnalysisId: input.evidenceAnalysis.id,
          evidenceRecordId: input.evidenceRecord.id,
          minSignalReasons: input.decision.policy.minSignalReasons,
          policyVersion: CRITICAL_ESCALATION_POLICY_VERSION,
          reasons: input.decision.reasons,
          recentHighSignalCount: input.decision.recentHighSignalCount,
          recommendedAction: input.evidenceAnalysis.recommendedAction,
          riskLevel: input.evidenceAnalysis.riskLevel,
        },
      },
    });

    return true;
  }

  private async dispatchCriticalContactsSafely(
    userId: string,
    alertSessionId: string,
  ): Promise<void> {
    try {
      await this.emergencyDispatchService.dispatchCriticalAlert(
        userId,
        alertSessionId,
        { source: 'ai_escalation' },
      );
    } catch {
      // Escalation and evidence analysis are already persisted. Unexpected
      // dispatch failures must not roll back the custody/analysis result.
    }
  }

  private async countRecentHighSignalAnalyses(
    tx: Prisma.TransactionClient,
    input: {
      evidenceAnalysis: EvidenceAnalysis;
      evidenceRecord: EvidenceRecord;
      policy: CriticalEscalationPolicyConfig;
      userId: string;
    },
  ): Promise<number> {
    if (input.policy.recurrenceMinPrevious <= 0) {
      return 0;
    }

    return tx.evidenceAnalysis.count({
      where: {
        id: { not: input.evidenceAnalysis.id },
        userId: input.userId,
        alertSessionId: input.evidenceRecord.alertSessionId,
        createdAt: {
          gte: new Date(Date.now() - input.policy.recurrenceWindowMs),
        },
        status: EvidenceAnalysisStatus.COMPLETED,
        OR: [
          { riskLevel: { in: ['HIGH', 'CRITICAL'] } },
          { shouldEscalate: true },
          { suggestedAlertLevel: AlertLevel.CRITICAL },
        ],
      },
    });
  }

  private collectCriticalEscalationReasons(
    aiResult: AnalyzeEvidenceResponse,
    policy: CriticalEscalationPolicyConfig,
  ): string[] {
    const reasons: string[] = [];

    if (aiResult.riskLevel === 'CRITICAL') {
      reasons.push('critical_risk_level');
    }

    if (this.hasConcreteThreatMatch(aiResult, policy)) {
      reasons.push('concrete_threat');
    }

    if (this.hasCriminalVerbalAggression(aiResult)) {
      reasons.push('criminal_verbal_aggression');
    }

    if (this.hasPhysicalAggressionAudio(aiResult, policy)) {
      reasons.push('physical_aggression_audio');
    }

    if (this.hasDistressAudio(aiResult, policy)) {
      reasons.push('distress_audio');
    }

    return reasons;
  }

  private hasConcreteThreatMatch(
    aiResult: AnalyzeEvidenceResponse,
    policy: CriticalEscalationPolicyConfig,
  ): boolean {
    return aiResult.threatMatches.some((item) => {
      const value = this.asRecord(item);

      if (!value) {
        return false;
      }

      const severity = this.normalize(this.getUnknownString(value, 'severity'));
      const confidence =
        this.getUnknownNumber(value, 'confidence') ?? aiResult.confidence;
      const text = this.normalize(
        [
          this.getUnknownString(value, 'label'),
          this.getUnknownString(value, 'type'),
          this.getUnknownString(value, 'category'),
          this.getUnknownString(value, 'evidence'),
        ]
          .filter(Boolean)
          .join(' '),
      );
      const hasThreatKeyword = this.includesAny(text, [
        'agress',
        'ameac',
        'ameaç',
        'arma',
        'concrete',
        'death',
        'kill',
        'lethal',
        'matar',
        'physical',
        'threat',
        'weapon',
      ]);

      return (
        confidence >= policy.threatConfidenceThreshold &&
        (severity === 'critical' ||
          ((severity === 'high' || !severity) && hasThreatKeyword))
      );
    });
  }

  private hasCriminalVerbalAggression(
    aiResult: AnalyzeEvidenceResponse,
  ): boolean {
    return this.hasDetectedSignal(aiResult, [
      'agressao_verbal',
      'agressão_verbal',
      'ameaca',
      'ameaça',
      'criminal_verbal',
      'grave_verbal',
      'threat',
      'verbal_abuse',
    ]);
  }

  private hasPhysicalAggressionAudio(
    aiResult: AnalyzeEvidenceResponse,
    policy: CriticalEscalationPolicyConfig,
  ): boolean {
    return this.hasAcousticEvent(aiResult, policy, [
      'agress',
      'agressão',
      'attack',
      'batida',
      'contact',
      'hit',
      'impact',
      'impacto',
      'punch',
      'slap',
      'tapa',
    ]);
  }

  private hasDistressAudio(
    aiResult: AnalyzeEvidenceResponse,
    policy: CriticalEscalationPolicyConfig,
  ): boolean {
    return (
      this.hasAcousticEvent(aiResult, policy, [
        'choro',
        'cry',
        'distress',
        'grito',
        'help',
        'scream',
        'sob',
        'socorro',
      ]) ||
      this.hasDetectedSignal(aiResult, [
        'active_distress_call',
        'choro',
        'cry',
        'distress',
        'grito',
        'help',
        'scream',
        'socorro',
      ])
    );
  }

  private hasAcousticEvent(
    aiResult: AnalyzeEvidenceResponse,
    policy: CriticalEscalationPolicyConfig,
    keywords: string[],
  ): boolean {
    return aiResult.acousticEvents.some((item) => {
      const value = this.asRecord(item);

      if (!value) {
        return false;
      }

      const confidence =
        this.getUnknownNumber(value, 'confidence') ?? aiResult.confidence;
      const text = this.normalize(
        [
          this.getUnknownString(value, 'label'),
          this.getUnknownString(value, 'type'),
          this.getUnknownString(value, 'category'),
        ]
          .filter(Boolean)
          .join(' '),
      );

      return (
        confidence >= policy.acousticConfidenceThreshold &&
        this.includesAny(text, keywords)
      );
    });
  }

  private hasDetectedSignal(
    aiResult: AnalyzeEvidenceResponse,
    keywords: string[],
  ): boolean {
    return aiResult.detectedSignals.some((signal) =>
      this.includesAny(this.normalize(signal), keywords),
    );
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

  private getCriticalEscalationPolicyConfig(): CriticalEscalationPolicyConfig {
    return {
      acousticConfidenceThreshold: this.getEnvNumber(
        'VERA_AI_CRITICAL_ACOUSTIC_CONFIDENCE_THRESHOLD',
        DEFAULT_CRITICAL_ACOUSTIC_CONFIDENCE_THRESHOLD,
        0,
        1,
      ),
      confidenceThreshold: this.getEnvNumber(
        'VERA_AI_CRITICAL_CONFIDENCE_THRESHOLD',
        DEFAULT_CRITICAL_CONFIDENCE_THRESHOLD,
        0,
        1,
      ),
      minSignalReasons: this.getEnvInteger(
        'VERA_AI_CRITICAL_MIN_SIGNAL_REASONS',
        DEFAULT_CRITICAL_MIN_SIGNAL_REASONS,
        1,
        10,
      ),
      recurrenceMinPrevious: this.getEnvInteger(
        'VERA_AI_CRITICAL_RECURRENCE_MIN_PREVIOUS',
        DEFAULT_CRITICAL_RECURRENCE_MIN_PREVIOUS,
        0,
        20,
      ),
      recurrenceWindowMs: this.getEnvInteger(
        'VERA_AI_CRITICAL_RECURRENCE_WINDOW_MS',
        DEFAULT_CRITICAL_RECURRENCE_WINDOW_MS,
        30 * 1000,
        24 * 60 * 60 * 1000,
      ),
      threatConfidenceThreshold: this.getEnvNumber(
        'VERA_AI_CRITICAL_THREAT_CONFIDENCE_THRESHOLD',
        DEFAULT_CRITICAL_THREAT_CONFIDENCE_THRESHOLD,
        0,
        1,
      ),
    };
  }

  private getEnvNumber(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = process.env[name];

    if (!value) {
      return fallback;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback;
  }

  private getEnvInteger(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = this.getEnvNumber(name, fallback, min, max);

    return Number.isInteger(parsed) ? parsed : fallback;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private getUnknownString(
    value: Record<string, unknown>,
    key: string,
  ): string | null {
    const item = value[key];

    return typeof item === 'string' ? item : null;
  }

  private getUnknownNumber(
    value: Record<string, unknown>,
    key: string,
  ): number | null {
    const item = value[key];

    return typeof item === 'number' && Number.isFinite(item) ? item : null;
  }

  private includesAny(value: string, keywords: string[]): boolean {
    return keywords.some((keyword) => value.includes(this.normalize(keyword)));
  }

  private normalize(value: string | null | undefined): string {
    return value?.trim().toLowerCase() ?? '';
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
