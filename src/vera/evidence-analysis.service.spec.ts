import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  EvidenceAnalysisStatus,
  EvidenceType,
  type AlertEvent,
  type EvidenceAnalysis,
  type EvidenceRecord,
} from '@prisma/client';
import { AiServiceClient } from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceAnalysisService } from './evidence-analysis.service';

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
    riskLevel?: string;
    suggestedAlertLevel?: AlertLevel;
    confidence?: number;
    summary?: string;
    detectedSignals?: string[];
    shouldEscalate?: boolean;
    failureReason?: string;
  };
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
    create: jest.Mock<Promise<EvidenceAnalysis>, [EvidenceAnalysisCreateArgs]>;
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
  $transaction: jest.Mock<Promise<EvidenceAnalysis>, [TransactionCallback]>;
};

type AiServiceClientMock = {
  analyzeEvidence: jest.Mock<
    ReturnType<AiServiceClient['analyzeEvidence']>,
    Parameters<AiServiceClient['analyzeEvidence']>
  >;
};

const baseEvidence = (
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  id: 'evidence-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: EvidenceType.AUDIO,
  size: 512,
  mimeType: 'audio/wav',
  originalName: 'audio.wav',
  storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
  contentHash: 'a'.repeat(64),
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
  id: 'analysis-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  evidenceRecordId: 'evidence-id',
  status: EvidenceAnalysisStatus.COMPLETED,
  riskLevel: 'CRITICAL',
  suggestedAlertLevel: AlertLevel.CRITICAL,
  confidence: 0.94,
  summary: 'Possible immediate danger detected.',
  detectedSignals: ['threatening_language'],
  shouldEscalate: true,
  failureReason: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
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

describe('EvidenceAnalysisService', () => {
  let service: EvidenceAnalysisService;
  let prisma: PrismaMock;
  let tx: TransactionClientMock;
  let aiServiceClient: AiServiceClientMock;

  beforeEach(() => {
    tx = {
      evidenceAnalysis: {
        create: jest.fn<
          Promise<EvidenceAnalysis>,
          [EvidenceAnalysisCreateArgs]
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
      $transaction: jest.fn<Promise<EvidenceAnalysis>, [TransactionCallback]>(),
    };
    aiServiceClient = {
      analyzeEvidence: jest.fn<
        ReturnType<AiServiceClient['analyzeEvidence']>,
        Parameters<AiServiceClient['analyzeEvidence']>
      >(),
    };

    prisma.$transaction.mockImplementation((callback) => callback(tx));
    tx.evidenceAnalysis.create.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseAnalysis({
          userId: data.userId,
          alertSessionId: data.alertSessionId,
          evidenceRecordId: data.evidenceRecordId,
          status: data.status,
          riskLevel: data.riskLevel ?? null,
          suggestedAlertLevel: data.suggestedAlertLevel ?? null,
          confidence: data.confidence ?? null,
          summary: data.summary ?? null,
          detectedSignals: data.detectedSignals ?? null,
          shouldEscalate: data.shouldEscalate ?? null,
          failureReason: data.failureReason ?? null,
        }),
      );
    });
    tx.alertEvent.create.mockResolvedValue(baseEvent());
    aiServiceClient.analyzeEvidence.mockResolvedValue({
      riskLevel: 'CRITICAL',
      confidence: 0.94,
      summary: 'Possible immediate danger detected.',
      detectedSignals: ['threatening_language'],
      shouldEscalate: true,
    });

    service = new EvidenceAnalysisService(
      prisma as unknown as PrismaService,
      aiServiceClient as unknown as AiServiceClient,
    );
  });

  it('analyzes user-owned evidence and persists the completed result', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(prisma.evidenceRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'evidence-id',
        userId: 'user-id',
        alertSessionId: 'session-id',
        hiddenFromUserAt: null,
        deletedAt: null,
      },
    });
    expect(aiServiceClient.analyzeEvidence).toHaveBeenCalledWith({
      evidenceRecordId: 'evidence-id',
      alertSessionId: 'session-id',
      evidenceType: EvidenceType.AUDIO,
      mimeType: 'audio/wav',
      size: 512,
      contentHash: 'a'.repeat(64),
    });
    expect(tx.evidenceAnalysis.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        evidenceRecordId: 'evidence-id',
        status: EvidenceAnalysisStatus.COMPLETED,
        riskLevel: 'CRITICAL',
        suggestedAlertLevel: AlertLevel.CRITICAL,
        confidence: 0.94,
        summary: 'Possible immediate danger detected.',
        detectedSignals: ['threatening_language'],
        shouldEscalate: true,
      },
    });
    expect(tx.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.AI_ANALYSIS_COMPLETED,
        message: 'AI analysis completed.',
        metadata: {
          status: EvidenceAnalysisStatus.COMPLETED,
          evidenceAnalysisId: 'analysis-id',
          evidenceRecordId: 'evidence-id',
          riskLevel: 'CRITICAL',
          confidence: 0.94,
          shouldEscalate: true,
          suggestedAlertLevel: AlertLevel.CRITICAL,
        },
      },
    });
    expect(result).toMatchObject({
      id: 'analysis-id',
      status: EvidenceAnalysisStatus.COMPLETED,
      suggestedAlertLevel: AlertLevel.CRITICAL,
      shouldEscalate: true,
    });
    expect(result).not.toHaveProperty('storagePath');
  });

  it('suggests normal alert level without changing the alert session', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    aiServiceClient.analyzeEvidence.mockResolvedValue({
      riskLevel: 'LOW',
      confidence: 0.72,
      summary: 'No critical signal detected.',
      detectedSignals: [],
      shouldEscalate: false,
    });

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    const createArgs = tx.evidenceAnalysis.create.mock.calls[0]?.[0];

    if (!createArgs) {
      throw new Error('Expected evidence analysis create call');
    }

    expect(createArgs.data.status).toBe(EvidenceAnalysisStatus.COMPLETED);
    expect(createArgs.data.suggestedAlertLevel).toBe(AlertLevel.NORMAL);
    expect(createArgs.data.riskLevel).toBe('LOW');
    expect(createArgs.data.shouldEscalate).toBe(false);
    expect(result.suggestedAlertLevel).toBe(AlertLevel.NORMAL);
  });

  it('persists failed analysis when the AI service fails', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    aiServiceClient.analyzeEvidence.mockRejectedValue(
      new ServiceUnavailableException('AI service is not configured.'),
    );

    const result = await service.analyze(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(tx.evidenceAnalysis.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        evidenceRecordId: 'evidence-id',
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
          evidenceAnalysisId: 'analysis-id',
          evidenceRecordId: 'evidence-id',
          failureReason: 'ai_service_http_503',
        },
      },
    });
    expect(result).toMatchObject({
      status: EvidenceAnalysisStatus.FAILED,
      failureReason: 'ai_service_http_503',
    });
  });

  it('does not analyze evidence from another user or hidden evidence', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(null);

    await expect(
      service.analyze('user-id', 'other-session-id', 'evidence-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(aiServiceClient.analyzeEvidence).not.toHaveBeenCalled();
    expect(tx.evidenceAnalysis.create).not.toHaveBeenCalled();
    expect(tx.alertEvent.create).not.toHaveBeenCalled();
  });
});
