import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
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

type PrismaMock = {
  evidenceRecord: {
    findFirst: jest.Mock;
  };
  evidenceAnalysis: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
};

type TransactionClientMock = {
  evidenceAnalysis: {
    count: jest.Mock;
    update: jest.Mock;
  };
  alertSession: {
    updateMany: jest.Mock;
  };
  alertEvent: {
    create: jest.Mock;
  };
};

type AiServiceClientMock = {
  analyzeEvidence: jest.Mock;
};

type EvidenceStorageMock = {
  downloadEvidence: jest.Mock;
};

type EmergencyDispatchServiceMock = {
  dispatchCriticalAlert: jest.Mock;
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
  requestKey: 'evidence-id',
  status: EvidenceAnalysisStatus.COMPLETED,
  attemptCount: 1,
  maxAttempts: 3,
  nextAttemptAt: null,
  lockedAt: null,
  lastAttemptAt: new Date('2026-05-28T10:00:00.000Z'),
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

const queuedAnalysis = (
  overrides: Partial<EvidenceAnalysis> = {},
): EvidenceAnalysis =>
  baseAnalysis({
    analysisId: null,
    analysisVersion: null,
    status: EvidenceAnalysisStatus.QUEUED,
    attemptCount: 0,
    nextAttemptAt: new Date('2026-05-28T10:00:00.000Z'),
    lockedAt: null,
    lastAttemptAt: null,
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
    ...overrides,
  });

const processingAnalysis = (
  overrides: Partial<EvidenceAnalysis> = {},
): EvidenceAnalysis =>
  queuedAnalysis({
    status: EvidenceAnalysisStatus.PROCESSING,
    attemptCount: 1,
    nextAttemptAt: null,
    lockedAt: new Date(),
    lastAttemptAt: new Date(),
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
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      alertSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      alertEvent: {
        create: jest.fn().mockResolvedValue(baseEvent()),
      },
    };
    prisma = {
      evidenceRecord: {
        findFirst: jest.fn().mockResolvedValue(baseEvidence()),
      },
      evidenceAnalysis: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(processingAnalysis()),
        update: jest.fn().mockResolvedValue(queuedAnalysis()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue(queuedAnalysis()),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: TransactionClientMock) => unknown) =>
            callback(tx),
        ),
    };
    aiServiceClient = {
      analyzeEvidence: jest.fn().mockResolvedValue(baseAiResult()),
    };
    evidenceStorage = {
      downloadEvidence: jest.fn().mockResolvedValue({
        bucket: 'vera-evidence',
        path: 'users/user-id/alert-sessions/session-id/audio.wav',
        contentType: 'audio/wav',
        size: audioBuffer.byteLength,
        body: toArrayBuffer(audioBuffer),
      }),
    };
    emergencyDispatchService = {
      dispatchCriticalAlert: jest.fn().mockResolvedValue({
        alreadyDispatched: false,
        alertSessionId: 'session-id',
        level: AlertLevel.CRITICAL,
        providerConfigured: true,
        attempts: [],
      }),
    };
    tx.evidenceAnalysis.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(
          baseAnalysis({
            analysisId: (data.analysisId as string | undefined) ?? null,
            analysisVersion:
              (data.analysisVersion as string | undefined) ?? null,
            status: data.status as EvidenceAnalysisStatus,
            riskLevel: (data.riskLevel as string | undefined) ?? null,
            suggestedAlertLevel:
              (data.suggestedAlertLevel as AlertLevel | undefined) ?? null,
            confidence: (data.confidence as number | undefined) ?? null,
            summary: (data.summary as string | undefined) ?? null,
            detectedSignals: data.detectedSignals ?? null,
            shouldEscalate:
              (data.shouldEscalate as boolean | undefined) ?? null,
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
        ),
    );

    service = new EvidenceAnalysisService(
      prisma as unknown as PrismaService,
      aiServiceClient as unknown as AiServiceClient,
      evidenceStorage as unknown as EvidenceStorageService,
      emergencyDispatchService as unknown as EmergencyDispatchService,
    );
  });

  async function enqueueAndProcess(
    claimed: EvidenceAnalysis = processingAnalysis(),
  ): Promise<void> {
    await service.analyze('user-id', 'session-id', 'evidence-id');
    prisma.evidenceAnalysis.findFirst.mockResolvedValueOnce(queuedAnalysis());
    prisma.evidenceAnalysis.findUnique.mockResolvedValueOnce(claimed);
    await service.processNextQueuedAnalysis();
  }

  it('queues an idempotent analysis request without calling the AI provider', async () => {
    const first = await service.analyze('user-id', 'session-id', 'evidence-id');
    const second = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(prisma.evidenceAnalysis.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.evidenceAnalysis.upsert).toHaveBeenCalledWith({
      where: { requestKey: 'evidence-id' },
      create: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        evidenceRecordId: 'evidence-id',
        requestKey: 'evidence-id',
        status: EvidenceAnalysisStatus.QUEUED,
        maxAttempts: 3,
        nextAttemptAt: expect.any(Date) as Date,
      },
      update: {},
    });
    expect(first).toMatchObject({
      id: 'analysis-row-id',
      status: EvidenceAnalysisStatus.QUEUED,
      attemptCount: 0,
      maxAttempts: 3,
    });
    expect(second.id).toBe(first.id);
    expect(aiServiceClient.analyzeEvidence).not.toHaveBeenCalled();
  });

  it('requeues the same row after a terminal failure', async () => {
    prisma.evidenceAnalysis.upsert.mockResolvedValue(
      baseAnalysis({
        status: EvidenceAnalysisStatus.FAILED,
        failureReason: 'ai_service_http_503',
      }),
    );
    prisma.evidenceAnalysis.findUnique.mockResolvedValueOnce(queuedAnalysis());

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(prisma.evidenceAnalysis.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'analysis-row-id',
        status: EvidenceAnalysisStatus.FAILED,
      },
      data: expect.objectContaining({
        status: EvidenceAnalysisStatus.QUEUED,
        attemptCount: 0,
        nextAttemptAt: expect.any(Date) as Date,
        lockedAt: null,
        failureReason: null,
      }) as Record<string, unknown>,
    });
    expect(result.status).toBe(EvidenceAnalysisStatus.QUEUED);
  });

  it('claims queued audio and persists the completed rich result', async () => {
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

    await enqueueAndProcess();

    expect(prisma.evidenceAnalysis.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'analysis-row-id',
        OR: expect.any(Array) as unknown[],
      },
      data: {
        status: EvidenceAnalysisStatus.PROCESSING,
        attemptCount: { increment: 1 },
        lockedAt: expect.any(Date) as Date,
        lastAttemptAt: expect.any(Date) as Date,
        nextAttemptAt: null,
      },
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
    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: expect.objectContaining({
        status: EvidenceAnalysisStatus.COMPLETED,
        suggestedAlertLevel: AlertLevel.CRITICAL,
        lockedAt: null,
        nextAttemptAt: null,
      }) as Record<string, unknown>,
    });
    expect(tx.alertSession.updateMany).toHaveBeenCalled();
    expect(emergencyDispatchService.dispatchCriticalAlert).toHaveBeenCalledWith(
      'user-id',
      'session-id',
      { source: 'ai_escalation' },
    );
  });

  it('does not escalate on a single weak signal', async () => {
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

    await enqueueAndProcess();

    expect(tx.evidenceAnalysis.count).toHaveBeenCalled();
    expect(tx.alertSession.updateMany).not.toHaveBeenCalled();
    expect(
      emergencyDispatchService.dispatchCriticalAlert,
    ).not.toHaveBeenCalled();
  });

  it('recovers an abandoned processing lock before analyzing', async () => {
    prisma.evidenceAnalysis.findFirst.mockResolvedValueOnce(
      processingAnalysis({
        attemptCount: 1,
        lockedAt: new Date('2026-05-28T09:00:00.000Z'),
      }),
    );
    prisma.evidenceAnalysis.findUnique.mockResolvedValueOnce(
      processingAnalysis({ attemptCount: 2 }),
    );

    const processed = await service.processNextQueuedAnalysis();

    expect(processed).toBe(true);
    expect(prisma.evidenceAnalysis.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            status: EvidenceAnalysisStatus.QUEUED,
            nextAttemptAt: { lte: expect.any(Date) as Date },
          },
          {
            status: EvidenceAnalysisStatus.PROCESSING,
            lockedAt: { lte: expect.any(Date) as Date },
          },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    });
    expect(aiServiceClient.analyzeEvidence).toHaveBeenCalled();
  });

  it('reschedules transient provider failures with exponential backoff', async () => {
    aiServiceClient.analyzeEvidence.mockRejectedValue(
      new ServiceUnavailableException('AI service unavailable.'),
    );

    await enqueueAndProcess();

    expect(prisma.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: {
        status: EvidenceAnalysisStatus.QUEUED,
        failureReason: 'ai_service_http_503',
        lockedAt: null,
        nextAttemptAt: expect.any(Date) as Date,
      },
    });
    expect(tx.evidenceAnalysis.update).not.toHaveBeenCalled();
  });

  it('persists terminal failure after the configured attempts are exhausted', async () => {
    aiServiceClient.analyzeEvidence.mockRejectedValue(
      new ServiceUnavailableException('AI service unavailable.'),
    );

    await enqueueAndProcess(processingAnalysis({ attemptCount: 3 }));

    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: {
        status: EvidenceAnalysisStatus.FAILED,
        failureReason: 'ai_service_http_503',
        lockedAt: null,
        nextAttemptAt: null,
        processingFinishedAt: expect.any(Date) as Date,
      },
    });
    expect(prisma.evidenceAnalysis.update).not.toHaveBeenCalled();
  });

  it('persists terminal failure when downloaded evidence hash mismatches', async () => {
    evidenceStorage.downloadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: 5,
      body: toArrayBuffer(Buffer.from('wrong')),
    });

    await enqueueAndProcess();

    expect(aiServiceClient.analyzeEvidence).not.toHaveBeenCalled();
    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: {
        status: EvidenceAnalysisStatus.FAILED,
        failureReason: 'stored_content_hash_mismatch',
        lockedAt: null,
        nextAttemptAt: null,
        processingFinishedAt: expect.any(Date) as Date,
      },
    });
  });

  it('marks the job failed if evidence disappears before processing', async () => {
    await service.analyze('user-id', 'session-id', 'evidence-id');
    prisma.evidenceAnalysis.findFirst.mockResolvedValueOnce(queuedAnalysis());
    prisma.evidenceAnalysis.findUnique.mockResolvedValueOnce(
      processingAnalysis(),
    );
    prisma.evidenceRecord.findFirst.mockResolvedValueOnce(null);

    await service.processNextQueuedAnalysis();

    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: {
        status: EvidenceAnalysisStatus.FAILED,
        failureReason: 'evidence_record_unavailable',
        lockedAt: null,
        nextAttemptAt: null,
        processingFinishedAt: expect.any(Date) as Date,
      },
    });
  });

  it('persists inconclusive analysis without escalation', async () => {
    aiServiceClient.analyzeEvidence.mockResolvedValue(
      baseAiResult({
        status: 'INCONCLUSIVE',
        riskLevel: 'UNKNOWN',
        confidence: 0,
        shouldEscalate: false,
        recommendedAction: 'REVIEW',
      }),
    );

    await enqueueAndProcess();

    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: expect.objectContaining({
        status: EvidenceAnalysisStatus.INCONCLUSIVE,
        suggestedAlertLevel: AlertLevel.NORMAL,
      }) as Record<string, unknown>,
    });
    expect(tx.alertSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not duplicate escalation when the session is already critical', async () => {
    tx.alertSession.updateMany.mockResolvedValue({ count: 0 });

    await enqueueAndProcess();

    expect(tx.alertEvent.create).toHaveBeenCalledTimes(1);
    expect(
      emergencyDispatchService.dispatchCriticalAlert,
    ).not.toHaveBeenCalled();
  });

  it('keeps the completed analysis if automatic contact dispatch throws', async () => {
    emergencyDispatchService.dispatchCriticalAlert.mockRejectedValue(
      new Error('dispatch unavailable'),
    );

    await enqueueAndProcess();

    expect(tx.evidenceAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis-row-id' },
      data: expect.objectContaining({
        status: EvidenceAnalysisStatus.COMPLETED,
      }) as Record<string, unknown>,
    });
  });

  it('finds the latest analysis for visible evidence', async () => {
    prisma.evidenceAnalysis.findFirst.mockResolvedValue(
      baseAnalysis({ id: 'latest-analysis-id' }),
    );

    const result = await service.findLatest(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(result).toMatchObject({
      id: 'latest-analysis-id',
      status: EvidenceAnalysisStatus.COMPLETED,
    });
  });

  it('rejects non-audio evidence before queueing', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(
      baseEvidence({
        type: EvidenceType.IMAGE,
        mimeType: 'image/jpeg',
      }),
    );

    await expect(
      service.analyze('user-id', 'session-id', 'evidence-id'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.evidenceAnalysis.upsert).not.toHaveBeenCalled();
  });

  it('does not queue evidence from another user or hidden evidence', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(null);

    await expect(
      service.analyze('user-id', 'other-session-id', 'evidence-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.evidenceAnalysis.upsert).not.toHaveBeenCalled();
  });
});
