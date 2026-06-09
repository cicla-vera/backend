import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  EvidenceAnalysisStatus,
  EvidenceAuditAction,
  EvidenceChunkChainStatus,
  EvidenceType,
  LocationSampleSource,
  type EvidenceAuditEvent,
} from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceExportService } from './evidence-export.service';
import {
  EvidenceTimestampService,
  type EvidenceTimestampReceipt,
} from './evidence-timestamp.service';

type PrismaMock = {
  alertSession: {
    findFirst: jest.Mock;
  };
};

type TimestampMock = {
  createTimestampReceipt: jest.Mock<
    Promise<EvidenceTimestampReceipt>,
    Parameters<EvidenceTimestampService['createTimestampReceipt']>
  >;
};

const contentHash = createHash('sha256').update('audio-bytes').digest('hex');
const startedAt = new Date('2026-06-03T12:00:00.000Z');
const createdAt = new Date('2026-06-03T12:00:08.000Z');

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
};

const calculateAuditHash = (
  event: Omit<EvidenceAuditEvent, 'id' | 'eventHash'>,
): string =>
  createHash('sha256')
    .update(
      stableStringify({
        action: event.action,
        contentHash: event.contentHash ?? null,
        createdAt: event.createdAt.toISOString(),
        evidenceRecordId: event.evidenceRecordId,
        hashAlgorithm: event.hashAlgorithm,
        metadata: event.metadata ?? null,
        previousEventHash: event.previousEventHash ?? null,
        userId: event.userId,
      }),
    )
    .digest('hex');

const baseAuditEvent = (
  overrides: Partial<EvidenceAuditEvent> = {},
): EvidenceAuditEvent => {
  const event: Omit<EvidenceAuditEvent, 'id' | 'eventHash'> = {
    userId: 'user-id',
    evidenceRecordId: 'evidence-id',
    action: EvidenceAuditAction.UPLOADED,
    contentHash,
    hashAlgorithm: 'SHA-256',
    previousEventHash: null,
    metadata: {
      alertSessionId: 'session-id',
      evidenceType: EvidenceType.AUDIO,
      mimeType: 'audio/wav',
      size: 11,
    },
    createdAt,
    ...overrides,
  };

  return {
    id: overrides.id ?? 'audit-event-id',
    ...event,
    eventHash: overrides.eventHash ?? calculateAuditHash(event),
  };
};

const baseSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-id',
  userId: 'user-id',
  safetyLocationId: null,
  trigger: AlertTrigger.MANUAL,
  status: AlertStatus.ACTIVE,
  level: AlertLevel.CRITICAL,
  startedAt,
  endedAt: null,
  criticalEscalatedAt: new Date('2026-06-03T12:00:20.000Z'),
  initialLatitude: -3.7319,
  initialLongitude: -38.5267,
  createdAt: startedAt,
  updatedAt: new Date('2026-06-03T12:00:21.000Z'),
  events: [
    {
      id: 'event-id',
      userId: 'user-id',
      alertSessionId: 'session-id',
      type: AlertEventType.EVIDENCE_UPLOADED,
      message: 'Evidence uploaded.',
      metadata: { evidenceRecordId: 'evidence-id' },
      latitude: null,
      longitude: null,
      createdAt,
    },
  ],
  locationSamples: [
    {
      id: 'location-sample-id',
      userId: 'user-id',
      alertSessionId: 'session-id',
      evidenceRecordId: 'evidence-id',
      latitude: -3.7319,
      longitude: -38.5267,
      accuracyMeters: 8,
      altitudeMeters: null,
      speedMetersPerSecond: null,
      headingDegrees: null,
      source: LocationSampleSource.BACKGROUND,
      capturedAt: new Date('2026-06-03T12:00:07.000Z'),
      metadata: null,
      createdAt,
    },
  ],
  evidenceRecords: [
    {
      id: 'evidence-id',
      userId: 'user-id',
      alertSessionId: 'session-id',
      type: EvidenceType.AUDIO,
      size: 11,
      mimeType: 'audio/wav',
      originalName: 'audio.wav',
      storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentHash,
      hashAlgorithm: 'SHA-256',
      hashedAt: createdAt,
      clientUploadId: 'queue-id',
      chunkSequenceId: 'sequence-id',
      chunkIndex: 0,
      previousChunkHash: null,
      chunkChainStatus: EvidenceChunkChainStatus.ROOT,
      hiddenFromUserAt: null,
      retentionUntil: null,
      deletedAt: null,
      metadata: {
        audioChunkHash: contentHash,
        audioChunkIndex: 0,
        audioChunkSequenceId: 'sequence-id',
        audioPreviousChunkHash: null,
      },
      createdAt,
      auditEvents: [baseAuditEvent()],
      analyses: [
        {
          id: 'analysis-id',
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
          lastAttemptAt: createdAt,
          riskLevel: 'critical',
          suggestedAlertLevel: AlertLevel.CRITICAL,
          confidence: 0.92,
          summary: 'Ameaça concreta detectada.',
          detectedSignals: ['threat'],
          shouldEscalate: true,
          recommendedAction: 'notify_emergency_contacts',
          evidenceWindow: { durationMs: 8000 },
          transcription: { text: 'vou te matar' },
          acousticEvents: [{ type: 'shouting' }],
          threatMatches: [{ evidence: 'vou te matar' }],
          providerMetadata: { provider: 'test' },
          processingStartedAt: createdAt,
          processingFinishedAt: new Date('2026-06-03T12:00:09.000Z'),
          latencyMs: 1000,
          failureReason: null,
          createdAt,
          updatedAt: new Date('2026-06-03T12:00:09.000Z'),
        },
      ],
    },
  ],
  ...overrides,
});

describe('EvidenceExportService', () => {
  let service: EvidenceExportService;
  let prisma: PrismaMock;
  let timestampService: TimestampMock;

  beforeEach(() => {
    prisma = {
      alertSession: {
        findFirst: jest.fn(),
      },
    };
    timestampService = {
      createTimestampReceipt: jest.fn((input) =>
        Promise.resolve({
          provider: 'test-timestamp',
          trustStatus: 'UNTRUSTED_SYSTEM_CLOCK',
          digest: input.digest,
          hashAlgorithm: input.hashAlgorithm,
          purpose: input.purpose,
          issuedAt: '2026-06-03T12:00:10.000Z',
          token: null,
          verificationUrl: null,
          notes: ['test receipt'],
        }),
      ),
    };
    service = new EvidenceExportService(
      prisma as unknown as PrismaService,
      timestampService,
    );
  });

  it('creates a verifiable technical manifest for a user-owned alert session', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    const manifest = await service.createManifest('user-id', 'session-id');

    expect(prisma.alertSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: 'user-id' },
      include: {
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        locationSamples: {
          orderBy: [{ capturedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
        evidenceRecords: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            auditEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            analyses: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });
    expect(manifest.manifestVersion).toBe('vera-evidence-export-v1');
    expect(manifest.alertSession.id).toBe('session-id');
    expect(manifest.evidenceRecords).toHaveLength(1);
    expect(manifest.evidenceRecords[0]).toMatchObject({
      id: 'evidence-id',
      storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentHash,
      hashAlgorithm: 'SHA-256',
      clientUploadId: 'queue-id',
      chunkSequenceId: 'sequence-id',
      chunkIndex: 0,
      previousChunkHash: null,
      chunkChainStatus: EvidenceChunkChainStatus.ROOT,
      analysisIds: ['analysis-id'],
      locationSampleIds: ['location-sample-id'],
    });
    expect(manifest.evidenceRecords[0]?.auditEvents[0]?.eventHash).toHaveLength(
      64,
    );
    expect(manifest.aiAnalyses[0]).toMatchObject({
      id: 'analysis-id',
      evidenceRecordId: 'evidence-id',
      status: EvidenceAnalysisStatus.COMPLETED,
      suggestedAlertLevel: AlertLevel.CRITICAL,
      shouldEscalate: true,
    });
    expect(manifest.custody).toMatchObject({
      evidenceRecordCount: 1,
      auditEventCount: 1,
      allAuditChainsValid: true,
      audioChunkSequences: [
        {
          sequenceId: 'sequence-id',
          chunkCount: 1,
          isValid: true,
          firstChunkHash: contentHash,
          lastChunkHash: contentHash,
          errors: [],
        },
      ],
    });
    expect(manifest.custody.auditChains[0]).toMatchObject({
      evidenceRecordId: 'evidence-id',
      auditEventCount: 1,
      isValid: true,
      errors: [],
    });
    expect(manifest.integrity).toMatchObject({
      manifestHashAlgorithm: 'SHA-256',
      manifestHashScope:
        'All manifest fields except integrity and trustedTimestamp.',
    });
    expect(manifest.integrity.manifestHash).toHaveLength(64);
    expect(timestampService.createTimestampReceipt).toHaveBeenCalledWith({
      digest: manifest.integrity.manifestHash,
      hashAlgorithm: 'SHA-256',
      purpose: 'vera-evidence-export-manifest',
    });
    expect(manifest.trustedTimestamp.digest).toBe(
      manifest.integrity.manifestHash,
    );
    expect(manifest.technicalValidity.limitations.join(' ')).toContain(
      'timestamp receipt uses backend system time',
    );
  });

  it('marks tampered audit chains as invalid in the manifest', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(
      baseSession({
        evidenceRecords: [
          {
            ...baseSession().evidenceRecords[0],
            auditEvents: [baseAuditEvent({ eventHash: 'b'.repeat(64) })],
          },
        ],
      }),
    );

    const manifest = await service.createManifest('user-id', 'session-id');

    expect(manifest.custody.allAuditChainsValid).toBe(false);
    expect(manifest.custody.auditChains[0]).toMatchObject({
      evidenceRecordId: 'evidence-id',
      isValid: false,
      errors: ['audit_event_audit-event-id_event_hash_mismatch'],
    });
  });

  it('rejects manifests for sessions from another user', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(null);

    await expect(
      service.createManifest('user-id', 'other-session-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(timestampService.createTimestampReceipt).not.toHaveBeenCalled();
  });
});
