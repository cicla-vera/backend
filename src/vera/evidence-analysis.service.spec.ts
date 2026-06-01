import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  EvidenceAnalysisStatus,
  EvidenceType,
  type AlertEvent,
  type EvidenceAnalysis,
  type EvidenceRecord,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  AiServiceClient,
  type AnalyzeEvidenceResponse,
} from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';
import { EmergencyDispatchService } from './emergency-dispatch.service';
import { EvidenceAnalysisService } from './evidence-analysis.service';
import { EvidenceStorageService } from './evidence-storage.service';

type EvidenceRecordFindFirstArgs = {
  where: {
    id: string;
    userId: string;
    alertSessionId: string;
    hiddenFromUserAt: null;
    deletedAt: null;
  };
};

type EvidenceAnalysisCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    evidenceRecordId: string;
    status: EvidenceAnalysisStatus;
  };
};

type EvidenceAnalysisUpdateArgs = {
  where: { id: string };
  data: Record<string, unknown>;
};

type EvidenceAnalysisFindFirstArgs = {
  where: {
    userId: string;
    alertSessionId: string;
    evidenceRecordId: string;
  };
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }];
};

type EvidenceAnalysisCountArgs = {
  where: Record<string, unknown>;
};

type AlertSessionUpdateManyArgs = {
  where: Record<string, unknown>;
  data: {
    level: AlertLevel;
    criticalEscalatedAt: Date;
  };
};

type AlertSessionUpdateManyResult = {
  count: number;
};

type AlertEventCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    type: AlertEventType;
    message: string;
    metadata: Record<string, unknown>;
  };
};

type TransactionClientMock = {
  evidenceAnalysis: {
    update: jest.Mock<Promise<EvidenceAnalysis>, [EvidenceAnalysisUpdateArgs]>;
    count: jest.Mock<Promise<number>, [EvidenceAnalysisCountArgs]>;
  };
  alertSession: {
    updateMany: jest.Mock<
      Promise<AlertSessionUpdateManyResult>,
      [AlertSessionUpdateManyArgs]
    >;
  };
  alertEvent: {
    create: jest.Mock<Promise<AlertEvent>, [AlertEventCreateArgs]>;
  };
};

type TransactionCallback = (
  tx: TransactionClientMock,
) => Promise<EvidenceAnalysis>;

type PrismaMock = {
  evidenceRecord: {
    findFirst: jest.Mock<
      Promise<EvidenceRecord | null>,
      [EvidenceRecordFindFirstArgs]
    >;
  };
  evidenceAnalysis: {
    create: jest.Mock<Promise<EvidenceAnalysis>, [EvidenceAnalysisCreateArgs]>;
    update: jest.Mock<Promise<EvidenceAnalysis>, [EvidenceAnalysisUpdateArgs]>;
    findFirst: jest.Mock<
      Promise<EvidenceAnalysis | null>,
      [EvidenceAnalysisFindFirstArgs]
    >;
  };
  $transaction: jest.Mock<Promise<EvidenceAnalysis>, [TransactionCallback]>;
};

type AiServiceClientMock = {
  analyzeEvidence: jest.Mock<
    ReturnType<AiServiceClient['analyzeEvidence']>,
    Parameters<AiServiceClient['analyzeEvidence']>
  >;
};

type EvidenceStorageMock = {
  downloadEvidence: jest.Mock<
    ReturnType<EvidenceStorageService['downloadEvidence']>,
    Parameters<EvidenceStorageService['downloadEvidence']>
  >;
};

type EmergencyDispatchServiceMock = {
  dispatchCriticalAlert: jest.Mock<
    ReturnType<EmergencyDispatchService['dispatchCriticalAlert']>,
    Parameters<EmergencyDispatchService['dispatchCriticalAlert']>
  >;
};

const audioBuffer = Buffer.from('audio-bytes');
const audioHash = createHash('sha256').update(audioBuffer).digest('hex');

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
};

const baseEvidence = (
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  id: 'evidence-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: EvidenceType.AUDIO,
  size: audioBuffer.byteLength,
  mimeType: 'audio/wav',
  originalName: 'audio.wav',
  storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
  contentHash: audioHash,
  hashAlgorithm: 'SHA-256',
  hashedAt: new Date('2026-05-24T00:00:00.000Z'),
  hiddenFromUserAt: null,
  retentionUntil: null,
  deletedAt: null,
  metadata: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseAnalysis = (
  overrides: Partial<EvidenceAnalysis> = {},
): EvidenceAnalysis => ({
  id: 'analysis-row-id',
  analysisId: 'ai-analysis-id',
  analysisVersion: 'audio-evidence-v1',
  userId: 'user-id',
  alertSessionId: 'session-id',
  evidenceRecordId: 'evidence-id',
  status: EvidenceAnalysisStatus.COMPLETED,
  riskLevel: 'CRITICAL',
  suggestedAlertLevel: AlertLevel.CRITICAL,
  confidence: 0.94,
  summary: 'Critical risk candidate detected.',
  detectedSignals: ['risk_level:CRITICAL'],
  shouldEscalate: true,
  recommendedAction: 'ESCALATE_CONTACTS',
  evidenceWindow: { durationMs: 12000 },
  transcription: { text: 'Eu vou te matar agora.' },
  acousticEvents: [],
  threatMatches: [{ label: 'concrete_lethal_threat' }],
  providerMetadata: { provider: 'mock' },
  processingStartedAt: new Date('2026-05-28T10:00:00.000Z'),
  processingFinishedAt: new Date('2026-05-28T10:00:01.000Z'),
  latencyMs: 1000,
  failureReason: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:01.000Z'),
  ...overrides,
});

const baseEvent = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'event-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: AlertEventType.AI_ANALYSIS_COMPLETED,
  message: 'AI analysis completed.',
  metadata: null,
  latitude: null,
  longitude: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseAiResult = (
  overrides: Partial<AnalyzeEvidenceResponse> = {},
): AnalyzeEvidenceResponse => ({
  analysisId: 'ai-analysis-id',
  analysisVersion: 'audio-evidence-v1',
  status: 'COMPLETED',
  riskLevel: 'CRITICAL',
  confidence: 0.94,
  summary: 'Critical risk candidate detected.',
  detectedSignals: ['risk_level:CRITICAL'],
  shouldEscalate: true,
  recommendedAction: 'ESCALATE_CONTACTS',
  evidenceWindow: { startedAt: null, endedAt: null, durationMs: null },
  transcription: {
    text: 'Eu vou te matar agora.',
    language: 'pt-BR',
    segments: [],
  },
  acousticEvents: [],
  threatMatches: [{ label: 'concrete_lethal_threat' }],
  providerMetadata: {
    provider: 'mock',
    model: 'mock-transcription',
    modelVersion: 'mock-transcription',
  },
  processingStartedAt: '2026-05-28T10:00:00.000Z',
  processingFinishedAt: '2026-05-28T10:00:01.000Z',
  latencyMs: 1000,
  failureReason: null,
  ...overrides,
});

describe('EvidenceAnalysisService', () => {
  let service: EvidenceAnalysisService;
  let prisma: PrismaMock;
  let tx: TransactionClientMock;
  let aiServiceClient: AiServiceClientMock;
  let evidenceStorage: EvidenceStorageMock;
  let emergencyDispatchService: EmergencyDispatchServiceMock;

  beforeEach(() => {
    tx = {
      evidenceAnalysis: {
        update: jest.fn<
          Promise<EvidenceAnalysis>,
          [EvidenceAnalysisUpdateArgs]
        >(),
        count: jest.fn<Promise<number>, [EvidenceAnalysisCountArgs]>(),
      },
      alertSession: {
        updateMany: jest.fn<
          Promise<AlertSessionUpdateManyResult>,
          [AlertSessionUpdateManyArgs]
        >(),
      },
      alertEvent: {
        create: jest.fn<Promise<AlertEvent>, [AlertEventCreateArgs]>(),
      },
    };
    prisma = {
      evidenceRecord: {
        findFirst: jest.fn<
          Promise<EvidenceRecord | null>,
          [EvidenceRecordFindFirstArgs]
        >(),
      },
      evidenceAnalysis: {
        create: jest.fn<
          Promise<EvidenceAnalysis>,
          [EvidenceAnalysisCreateArgs]
        >(),
        update: jest.fn<
          Promise<EvidenceAnalysis>,
          [EvidenceAnalysisUpdateArgs]
        >(),
        findFirst: jest.fn<
          Promise<EvidenceAnalysis | null>,
          [EvidenceAnalysisFindFirstArgs]
        >(),
      },
      $transaction: jest.fn<Promise<EvidenceAnalysis>, [TransactionCallback]>(),
    };
    aiServiceClient = {
      analyzeEvidence: jest.fn<
        ReturnType<AiServiceClient['analyzeEvidence']>,
        Parameters<AiServiceClient['analyzeEvidence']>
      >(),
    };
    evidenceStorage = {
      downloadEvidence: jest.fn<
        ReturnType<EvidenceStorageService['downloadEvidence']>,
        Parameters<EvidenceStorageService['downloadEvidence']>
      >(),
    };
    emergencyDispatchService = {
      dispatchCriticalAlert: jest.fn<
        ReturnType<EmergencyDispatchService['dispatchCriticalAlert']>,
        Parameters<EmergencyDispatchService['dispatchCriticalAlert']>
      >(),
    };

    prisma.$transaction.mockImplementation((callback) => callback(tx));
    prisma.evidenceAnalysis.create.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseAnalysis({
          id: 'analysis-row-id',
          analysisId: null,
          analysisVersion: null,
          userId: data.userId,
          alertSessionId: data.alertSessionId,
          evidenceRecordId: data.evidenceRecordId,
          status: data.status,
          riskLevel: null,
          suggestedAlertLevel: null,
          confidence: null,
          summary: null,
          detectedSignals: null,
          shouldEscalate: null,
          recommendedAction: null,
          evidenceWindow: null,
          transcription: null,
          acousticEvents: null,
          threatMatches: null,
          providerMetadata: null,
          processingStartedAt: null,
          processingFinishedAt: null,
          latencyMs: null,
          failureReason: null,
        }),
      );
    });
    prisma.evidenceAnalysis.update.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseAnalysis({
          status: data.status as EvidenceAnalysisStatus,
        }),
      );
    });
    tx.evidenceAnalysis.update.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseAnalysis({
          analysisId: (data.analysisId as string | undefined) ?? null,
          analysisVersion: (data.analysisVersion as string | undefined) ?? null,
          status: data.status as EvidenceAnalysisStatus,
          riskLevel: (data.riskLevel as string | undefined) ?? null,
          suggestedAlertLevel:
            (data.suggestedAlertLevel as AlertLevel | undefined) ?? null,
          confidence: (data.confidence as number | undefined) ?? null,
          summary: (data.summary as string | undefined) ?? null,
          detectedSignals: data.detectedSignals ?? null,
          shouldEscalate: (data.shouldEscalate as boolean | undefined) ?? null,
          recommendedAction:
            (data.recommendedAction as string | undefined) ?? null,
          evidenceWindow: data.evidenceWindow ?? null,
          transcription: data.transcription ?? null,
          acousticEvents: data.acousticEvents ?? null,
          threatMatches: data.threatMatches ?? null,
          providerMetadata: data.providerMetadata ?? null,
          processingStartedAt:
            (data.processingStartedAt as Date | undefined) ?? null,
          processingFinishedAt:
            (data.processingFinishedAt as Date | undefined) ?? null,
          latencyMs: (data.latencyMs as number | undefined) ?? null,
          failureReason: (data.failureReason as string | undefined) ?? null,
        }),
      );
    });
    tx.evidenceAnalysis.count.mockResolvedValue(0);
    tx.alertSession.updateMany.mockResolvedValue({ count: 1 });
    tx.alertEvent.create.mockResolvedValue(baseEvent());
    evidenceStorage.downloadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: audioBuffer.byteLength,
      body: toArrayBuffer(audioBuffer),
    });
    aiServiceClient.analyzeEvidence.mockResolvedValue(baseAiResult());
    emergencyDispatchService.dispatchCriticalAlert.mockResolvedValue({
      alreadyDispatched: false,
      alertSessionId: 'session-id',
      level: AlertLevel.CRITICAL,
      providerConfigured: true,
      attempts: [],
    });

    service = new EvidenceAnalysisService(
      prisma as unknown as PrismaService,
      aiServiceClient as unknown as AiServiceClient,
      evidenceStorage as unknown as EvidenceStorageService,
      emergencyDispatchService as unknown as EmergencyDispatchService,
    );
  });

  it('analyzes audio evidence and persists the completed rich result', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(
      baseEvidence({
        metadata: {
          captureStartedAt: '2026-05-28T10:00:00Z',
          captureEndedAt: '2026-05-28T10:00:12Z',
          triggerReasons: 'voice_activity,volume_spike',
          latitude: -3.7319,
          longitude: -38.5267,
        },
      }),
    );

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(prisma.evidenceAnalysis.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        evidenceRecordId: 'evidence-id',
        status: EvidenceAnalysisStatus.QUEUED,
      },
    });
    expect(prisma.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: { status: EvidenceAnalysisStatus.PROCESSING },
    });
    expect(evidenceStorage.downloadEvidence).toHaveBeenCalledWith(
      'users/user-id/alert-sessions/session-id/audio.wav',
    );
    expect(aiServiceClient.analyzeEvidence).toHaveBeenCalledWith({
      evidenceRecordId: 'evidence-id',
      alertSessionId: 'session-id',
      evidenceType: EvidenceType.AUDIO,
      mimeType: 'audio/wav',
      size: audioBuffer.byteLength,
      contentHash: audioHash,
      storageReference: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
      captureContext: {
        captureStartedAt: '2026-05-28T10:00:00Z',
        captureEndedAt: '2026-05-28T10:00:12Z',
        triggerReasons: ['voice_activity', 'volume_spike'],
        location: {
          latitude: -3.7319,
          longitude: -38.5267,
        },
      },
    });
    const completedUpdate = tx.evidenceAnalysis.update.mock.calls[0]?.[0];

    expect(completedUpdate?.where).toEqual({ id: 'analysis-row-id' });
    expect(completedUpdate?.data).toMatchObject({
      analysisId: 'ai-analysis-id',
      analysisVersion: 'audio-evidence-v1',
      status: EvidenceAnalysisStatus.COMPLETED,
      riskLevel: 'CRITICAL',
      suggestedAlertLevel: AlertLevel.CRITICAL,
      confidence: 0.94,
      summary: 'Critical risk candidate detected.',
      detectedSignals: ['risk_level:CRITICAL'],
      shouldEscalate: true,
      recommendedAction: 'ESCALATE_CONTACTS',
      failureReason: null,
    });
    expect(tx.alertEvent.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.AI_ANALYSIS_COMPLETED,
        message: 'AI analysis completed.',
        metadata: {
          status: EvidenceAnalysisStatus.COMPLETED,
          evidenceAnalysisId: 'analysis-row-id',
          evidenceRecordId: 'evidence-id',
          riskLevel: 'CRITICAL',
          confidence: 0.94,
          shouldEscalate: true,
          recommendedAction: 'ESCALATE_CONTACTS',
          suggestedAlertLevel: AlertLevel.CRITICAL,
          failureReason: null,
          provider: 'mock',
        },
      },
    });
    expect(tx.alertSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-id',
        userId: 'user-id',
        status: AlertStatus.ACTIVE,
        level: AlertLevel.NORMAL,
      },
      data: {
        level: AlertLevel.CRITICAL,
        criticalEscalatedAt: expect.any(Date) as Date,
      },
    });
    expect(tx.alertEvent.create).toHaveBeenNthCalledWith(2, {
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.ALERT_ESCALATED,
        message: 'Vera AI escalated the alert to critical.',
        metadata: expect.objectContaining({
          confidence: 0.94,
          confidenceThreshold: 0.78,
          evidenceAnalysisId: 'analysis-row-id',
          evidenceRecordId: 'evidence-id',
          minSignalReasons: 2,
          policyVersion: 'vera-ai-critical-v1',
          reasons: expect.arrayContaining([
            'critical_risk_level',
            'concrete_threat',
          ]) as string[],
          recentHighSignalCount: 0,
          recommendedAction: 'ESCALATE_CONTACTS',
          riskLevel: 'CRITICAL',
        }) as Record<string, unknown>,
      },
    });
    expect(emergencyDispatchService.dispatchCriticalAlert).toHaveBeenCalledWith(
      'user-id',
      'session-id',
      { source: 'ai_escalation' },
    );
    expect(result).toMatchObject({
      id: 'analysis-row-id',
      status: EvidenceAnalysisStatus.COMPLETED,
      suggestedAlertLevel: AlertLevel.CRITICAL,
      shouldEscalate: true,
      transcription: {
        text: 'Eu vou te matar agora.',
        language: 'pt-BR',
        segments: [],
      },
    });
    expect(result).not.toHaveProperty('storagePath');
  });

  it('does not escalate on a single weak signal even when AI suggests escalation', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    aiServiceClient.analyzeEvidence.mockResolvedValue(
      baseAiResult({
        riskLevel: 'HIGH',
        confidence: 0.82,
        detectedSignals: ['active_distress_call'],
        threatMatches: [],
        acousticEvents: [{ label: 'cry', confidence: 0.8 }],
        shouldEscalate: true,
        recommendedAction: 'ESCALATE_CONTACTS',
      }),
    );

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(result.suggestedAlertLevel).toBe(AlertLevel.CRITICAL);
    expect(tx.evidenceAnalysis.count).toHaveBeenCalled();
    expect(tx.alertSession.updateMany).not.toHaveBeenCalled();
    expect(tx.alertEvent.create).toHaveBeenCalledTimes(1);
    expect(
      emergencyDispatchService.dispatchCriticalAlert,
    ).not.toHaveBeenCalled();
  });

  it('escalates high risk audio when distress recurs in the temporal window', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    tx.evidenceAnalysis.count.mockResolvedValue(1);
    aiServiceClient.analyzeEvidence.mockResolvedValue(
      baseAiResult({
        riskLevel: 'HIGH',
        confidence: 0.88,
        detectedSignals: ['active_distress_call'],
        threatMatches: [],
        acousticEvents: [],
        shouldEscalate: true,
        recommendedAction: 'ESCALATE_CONTACTS',
      }),
    );

    await service.analyze('user-id', 'session-id', 'evidence-id');

    expect(tx.evidenceAnalysis.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { not: 'analysis-row-id' },
        userId: 'user-id',
        alertSessionId: 'session-id',
        status: EvidenceAnalysisStatus.COMPLETED,
      }) as Record<string, unknown>,
    });
    expect(tx.alertSession.updateMany).toHaveBeenCalled();
    expect(tx.alertEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        type: AlertEventType.ALERT_ESCALATED,
        metadata: expect.objectContaining({
          reasons: expect.arrayContaining([
            'distress_audio',
            'temporal_recurrence',
          ]) as string[],
          recentHighSignalCount: 1,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
    expect(emergencyDispatchService.dispatchCriticalAlert).toHaveBeenCalledWith(
      'user-id',
      'session-id',
      { source: 'ai_escalation' },
    );
  });

  it('does not persist an escalation event when the active session update is rejected', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    tx.alertSession.updateMany.mockResolvedValue({ count: 0 });

    await service.analyze('user-id', 'session-id', 'evidence-id');

    expect(tx.alertSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-id',
        userId: 'user-id',
        status: AlertStatus.ACTIVE,
        level: AlertLevel.NORMAL,
      },
      data: {
        level: AlertLevel.CRITICAL,
        criticalEscalatedAt: expect.any(Date) as Date,
      },
    });
    expect(tx.alertEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.alertEvent.create.mock.calls[0]?.[0].data.type).toBe(
      AlertEventType.AI_ANALYSIS_COMPLETED,
    );
    expect(
      emergencyDispatchService.dispatchCriticalAlert,
    ).not.toHaveBeenCalled();
  });

  it('keeps the analysis result when automatic contact dispatch throws unexpectedly', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    emergencyDispatchService.dispatchCriticalAlert.mockRejectedValue(
      new Error('dispatch unavailable'),
    );

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(result.status).toBe(EvidenceAnalysisStatus.COMPLETED);
    expect(tx.alertSession.updateMany).toHaveBeenCalled();
    expect(emergencyDispatchService.dispatchCriticalAlert).toHaveBeenCalled();
  });

  it('persists inconclusive analysis without critical escalation', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    aiServiceClient.analyzeEvidence.mockResolvedValue(
      baseAiResult({
        status: 'INCONCLUSIVE',
        riskLevel: 'UNKNOWN',
        confidence: 0,
        shouldEscalate: false,
        recommendedAction: 'REVIEW',
        transcription: { text: '', language: 'pt-BR', segments: [] },
      }),
    );

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    const inconclusiveUpdate = tx.evidenceAnalysis.update.mock.calls[0]?.[0];

    expect(inconclusiveUpdate?.where).toEqual({ id: 'analysis-row-id' });
    expect(inconclusiveUpdate?.data).toMatchObject({
      status: EvidenceAnalysisStatus.INCONCLUSIVE,
      riskLevel: 'UNKNOWN',
      suggestedAlertLevel: AlertLevel.NORMAL,
      shouldEscalate: false,
    });
    const inconclusiveEvent = tx.alertEvent.create.mock.calls[0]?.[0];

    expect(inconclusiveEvent?.data.message).toBe('AI analysis inconclusive.');
    expect(tx.alertSession.updateMany).not.toHaveBeenCalled();
    expect(result.status).toBe(EvidenceAnalysisStatus.INCONCLUSIVE);
  });

  it('persists failed analysis when the AI service throws', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    aiServiceClient.analyzeEvidence.mockRejectedValue(
      new ServiceUnavailableException('AI service is not configured.'),
    );

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: {
        status: EvidenceAnalysisStatus.FAILED,
        failureReason: 'ai_service_http_503',
      },
    });
    expect(tx.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.AI_ANALYSIS_COMPLETED,
        message: 'AI analysis failed.',
        metadata: {
          status: EvidenceAnalysisStatus.FAILED,
          evidenceAnalysisId: 'analysis-row-id',
          evidenceRecordId: 'evidence-id',
          failureReason: 'ai_service_http_503',
        },
      },
    });
    expect(result).toMatchObject({
      status: EvidenceAnalysisStatus.FAILED,
      failureReason: 'ai_service_http_503',
    });
    expect(tx.alertSession.updateMany).not.toHaveBeenCalled();
  });

  it('persists failed analysis when downloaded evidence hash mismatches', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    evidenceStorage.downloadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: 5,
      body: toArrayBuffer(Buffer.from('wrong')),
    });

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(aiServiceClient.analyzeEvidence).not.toHaveBeenCalled();
    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: {
        status: EvidenceAnalysisStatus.FAILED,
        failureReason: 'stored_content_hash_mismatch',
      },
    });
    expect(result.failureReason).toBe('stored_content_hash_mismatch');
  });

  it('rejects non-audio evidence before creating an analysis row', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(
      baseEvidence({
        type: EvidenceType.IMAGE,
        mimeType: 'image/jpeg',
      }),
    );

    await expect(
      service.analyze('user-id', 'session-id', 'evidence-id'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.evidenceAnalysis.create).not.toHaveBeenCalled();
    expect(aiServiceClient.analyzeEvidence).not.toHaveBeenCalled();
  });

  it('finds the latest analysis for visible evidence', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    prisma.evidenceAnalysis.findFirst.mockResolvedValue(
      baseAnalysis({ id: 'latest-analysis-id' }),
    );

    const result = await service.findLatest(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(prisma.evidenceAnalysis.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        evidenceRecordId: 'evidence-id',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(result).toMatchObject({
      id: 'latest-analysis-id',
      status: EvidenceAnalysisStatus.COMPLETED,
    });
  });

  it('does not analyze evidence from another user or hidden evidence', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(null);

    await expect(
      service.analyze('user-id', 'other-session-id', 'evidence-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(aiServiceClient.analyzeEvidence).not.toHaveBeenCalled();
    expect(prisma.evidenceAnalysis.create).not.toHaveBeenCalled();
    expect(tx.alertEvent.create).not.toHaveBeenCalled();
  });
});
