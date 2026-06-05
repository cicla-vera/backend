import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EvidenceAuditAction,
  type EvidenceAuditEvent,
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  EvidenceChunkChainStatus,
  EvidenceType,
  type AlertEvent,
  type AlertSession,
  type EvidenceRecord,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceService, type UploadedEvidenceFile } from './evidence.service';
import { EvidenceStorageService } from './evidence-storage.service';

type AlertSessionFindFirstArgs = {
  where: { id: string; userId: string };
};

type EvidenceRecordCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    type: EvidenceType;
    size: number;
    mimeType: string;
    originalName: string | null;
    storagePath: string;
    contentHash: string;
    hashAlgorithm: string;
    hashedAt: Date;
    clientUploadId: string | null;
    chunkSequenceId: string | null;
    chunkIndex: number | null;
    previousChunkHash: string | null;
    chunkChainStatus: EvidenceChunkChainStatus;
    metadata?: Record<string, string | number | boolean | null>;
  };
};

type EvidenceRecordFindFirstArgs = {
  where: Record<string, unknown>;
};

type EvidenceRecordFindManyArgs = {
  where: {
    userId: string;
    alertSessionId: string;
    hiddenFromUserAt: null;
    deletedAt: null;
  };
  orderBy: { createdAt: 'desc' };
};

type EvidenceRecordUpdateArgs = {
  where: { id: string };
  data: {
    hiddenFromUserAt?: Date;
    retentionUntil?: Date;
    chunkChainStatus?: EvidenceChunkChainStatus;
  };
};

type AlertEventCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    type: AlertEventType;
    message: string;
    metadata: Record<string, string | number | boolean | null>;
  };
};

type EvidenceAuditEventFindFirstArgs = {
  where: { evidenceRecordId: string };
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }];
  select: { eventHash: true };
};

type EvidenceAuditEventCreateArgs = {
  data: {
    userId: string;
    evidenceRecordId: string;
    action: EvidenceAuditAction;
    contentHash?: string;
    hashAlgorithm: string;
    previousEventHash?: string;
    eventHash: string;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt: Date;
  };
};

type TransactionClientMock = {
  evidenceRecord: {
    create: jest.Mock<Promise<EvidenceRecord>, [EvidenceRecordCreateArgs]>;
    findFirst: jest.Mock<
      Promise<EvidenceRecord | null>,
      [EvidenceRecordFindFirstArgs]
    >;
    update: jest.Mock<Promise<EvidenceRecord>, [EvidenceRecordUpdateArgs]>;
  };
  evidenceAuditEvent: {
    findFirst: jest.Mock<
      Promise<{ eventHash: string } | null>,
      [EvidenceAuditEventFindFirstArgs]
    >;
    create: jest.Mock<
      Promise<EvidenceAuditEvent>,
      [EvidenceAuditEventCreateArgs]
    >;
  };
  alertEvent: {
    create: jest.Mock<Promise<AlertEvent>, [AlertEventCreateArgs]>;
  };
};

type TransactionCallback = (
  tx: TransactionClientMock,
) => Promise<EvidenceRecord>;

type PrismaMock = {
  alertSession: {
    findFirst: jest.Mock<
      Promise<AlertSession | null>,
      [AlertSessionFindFirstArgs]
    >;
  };
  evidenceRecord: {
    findFirst: jest.Mock<
      Promise<EvidenceRecord | null>,
      [EvidenceRecordFindFirstArgs]
    >;
    findMany: jest.Mock<
      Promise<EvidenceRecord[]>,
      [EvidenceRecordFindManyArgs]
    >;
  };
  evidenceAuditEvent: {
    findFirst: jest.Mock<
      Promise<{ eventHash: string } | null>,
      [EvidenceAuditEventFindFirstArgs]
    >;
    create: jest.Mock<
      Promise<EvidenceAuditEvent>,
      [EvidenceAuditEventCreateArgs]
    >;
  };
  $transaction: jest.Mock<Promise<EvidenceRecord>, [TransactionCallback]>;
};

type EvidenceStorageMock = {
  uploadEvidence: jest.Mock<
    ReturnType<EvidenceStorageService['uploadEvidence']>,
    Parameters<EvidenceStorageService['uploadEvidence']>
  >;
  downloadEvidence: jest.Mock<
    ReturnType<EvidenceStorageService['downloadEvidence']>,
    Parameters<EvidenceStorageService['downloadEvidence']>
  >;
};

const hashBuffer = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex');

const audioBuffer = Buffer.from('audio-bytes');
const audioHash = hashBuffer(audioBuffer);

const baseSession = (overrides: Partial<AlertSession> = {}): AlertSession => ({
  id: 'session-id',
  userId: 'user-id',
  safetyLocationId: null,
  trigger: AlertTrigger.MANUAL,
  status: AlertStatus.ACTIVE,
  level: AlertLevel.NORMAL,
  startedAt: new Date('2026-05-24T00:00:00.000Z'),
  endedAt: null,
  criticalEscalatedAt: null,
  initialLatitude: null,
  initialLongitude: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

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
  clientUploadId: null,
  chunkSequenceId: null,
  chunkIndex: null,
  previousChunkHash: null,
  chunkChainStatus: EvidenceChunkChainStatus.NOT_APPLICABLE,
  hiddenFromUserAt: null,
  retentionUntil: null,
  deletedAt: null,
  metadata: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseAuditEvent = (
  overrides: Partial<EvidenceAuditEvent> = {},
): EvidenceAuditEvent => ({
  id: 'audit-event-id',
  userId: 'user-id',
  evidenceRecordId: 'evidence-id',
  action: EvidenceAuditAction.UPLOADED,
  contentHash: audioHash,
  hashAlgorithm: 'SHA-256',
  previousEventHash: null,
  eventHash: 'a'.repeat(64),
  metadata: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseEvent = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'event-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: AlertEventType.EVIDENCE_UPLOADED,
  message: 'Evidence uploaded.',
  metadata: null,
  latitude: null,
  longitude: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const audioFile = (
  overrides: Partial<UploadedEvidenceFile> = {},
): UploadedEvidenceFile => ({
  buffer: audioBuffer,
  originalname: 'audio.wav',
  mimetype: 'audio/wav',
  size: audioBuffer.byteLength,
  ...overrides,
});

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
};

describe('EvidenceService', () => {
  let service: EvidenceService;
  let prisma: PrismaMock;
  let tx: TransactionClientMock;
  let evidenceStorage: EvidenceStorageMock;

  beforeEach(() => {
    tx = {
      evidenceRecord: {
        create: jest.fn<Promise<EvidenceRecord>, [EvidenceRecordCreateArgs]>(),
        findFirst: jest.fn<
          Promise<EvidenceRecord | null>,
          [EvidenceRecordFindFirstArgs]
        >(),
        update: jest.fn<Promise<EvidenceRecord>, [EvidenceRecordUpdateArgs]>(),
      },
      evidenceAuditEvent: {
        findFirst: jest.fn<
          Promise<{ eventHash: string } | null>,
          [EvidenceAuditEventFindFirstArgs]
        >(),
        create: jest.fn<
          Promise<EvidenceAuditEvent>,
          [EvidenceAuditEventCreateArgs]
        >(),
      },
      alertEvent: {
        create: jest.fn<Promise<AlertEvent>, [AlertEventCreateArgs]>(),
      },
    };
    prisma = {
      alertSession: {
        findFirst: jest.fn<
          Promise<AlertSession | null>,
          [AlertSessionFindFirstArgs]
        >(),
      },
      evidenceRecord: {
        findFirst: jest.fn<
          Promise<EvidenceRecord | null>,
          [EvidenceRecordFindFirstArgs]
        >(),
        findMany: jest.fn<
          Promise<EvidenceRecord[]>,
          [EvidenceRecordFindManyArgs]
        >(),
      },
      evidenceAuditEvent: {
        findFirst: jest.fn<
          Promise<{ eventHash: string } | null>,
          [EvidenceAuditEventFindFirstArgs]
        >(),
        create: jest.fn<
          Promise<EvidenceAuditEvent>,
          [EvidenceAuditEventCreateArgs]
        >(),
      },
      $transaction: jest.fn<Promise<EvidenceRecord>, [TransactionCallback]>(),
    };
    evidenceStorage = {
      uploadEvidence: jest.fn<
        ReturnType<EvidenceStorageService['uploadEvidence']>,
        Parameters<EvidenceStorageService['uploadEvidence']>
      >(),
      downloadEvidence: jest.fn<
        ReturnType<EvidenceStorageService['downloadEvidence']>,
        Parameters<EvidenceStorageService['downloadEvidence']>
      >(),
    };

    prisma.$transaction.mockImplementation((callback) => callback(tx));
    tx.evidenceRecord.create.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseEvidence({
          userId: data.userId,
          alertSessionId: data.alertSessionId,
          type: data.type,
          size: data.size,
          mimeType: data.mimeType,
          originalName: data.originalName,
          storagePath: data.storagePath,
          contentHash: data.contentHash,
          hashAlgorithm: data.hashAlgorithm,
          hashedAt: data.hashedAt,
          clientUploadId: data.clientUploadId,
          chunkSequenceId: data.chunkSequenceId,
          chunkIndex: data.chunkIndex,
          previousChunkHash: data.previousChunkHash,
          chunkChainStatus: data.chunkChainStatus,
          metadata: data.metadata ?? null,
        }),
      );
    });
    tx.evidenceRecord.update.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseEvidence({
          ...(data.hiddenFromUserAt
            ? { hiddenFromUserAt: data.hiddenFromUserAt }
            : {}),
          ...(data.retentionUntil
            ? { retentionUntil: data.retentionUntil }
            : {}),
          ...(data.chunkChainStatus
            ? { chunkChainStatus: data.chunkChainStatus }
            : {}),
        }),
      );
    });
    tx.evidenceRecord.findFirst.mockResolvedValue(null);
    tx.alertEvent.create.mockResolvedValue(baseEvent());
    tx.evidenceAuditEvent.findFirst.mockResolvedValue(null);
    tx.evidenceAuditEvent.create.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseAuditEvent({
          userId: data.userId,
          evidenceRecordId: data.evidenceRecordId,
          action: data.action,
          contentHash: data.contentHash ?? null,
          hashAlgorithm: data.hashAlgorithm,
          previousEventHash: data.previousEventHash ?? null,
          eventHash: data.eventHash,
          metadata: data.metadata ?? null,
          createdAt: data.createdAt,
        }),
      );
    });
    prisma.evidenceAuditEvent.findFirst.mockResolvedValue(null);
    prisma.evidenceAuditEvent.create.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseAuditEvent({
          userId: data.userId,
          evidenceRecordId: data.evidenceRecordId,
          action: data.action,
          contentHash: data.contentHash ?? null,
          hashAlgorithm: data.hashAlgorithm,
          previousEventHash: data.previousEventHash ?? null,
          eventHash: data.eventHash,
          metadata: data.metadata ?? null,
          createdAt: data.createdAt,
        }),
      );
    });
    evidenceStorage.uploadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: audioBuffer.byteLength,
      uploadedAt: new Date('2026-05-24T00:00:00.000Z'),
    });
    evidenceStorage.downloadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: audioBuffer.byteLength,
      body: toArrayBuffer(audioBuffer),
    });

    service = new EvidenceService(
      prisma as unknown as PrismaService,
      evidenceStorage as unknown as EvidenceStorageService,
    );
  });

  it('uploads a user-owned session evidence file and records a timeline event', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    const result = await service.upload(
      'user-id',
      'session-id',
      {
        type: EvidenceType.AUDIO,
        metadata: '{"source":"microphone","confidence":0.91}',
      },
      audioFile(),
    );

    expect(prisma.alertSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: 'user-id' },
    });
    expect(evidenceStorage.uploadEvidence).toHaveBeenCalledWith({
      userId: 'user-id',
      alertSessionId: 'session-id',
      fileName: 'audio.wav',
      contentType: 'audio/wav',
      body: audioBuffer,
    });

    const createArgs = tx.evidenceRecord.create.mock.calls[0]?.[0];

    if (!createArgs) {
      throw new Error('Expected evidence record create call');
    }

    expect(createArgs.data).toMatchObject({
      userId: 'user-id',
      alertSessionId: 'session-id',
      type: EvidenceType.AUDIO,
      size: audioBuffer.byteLength,
      mimeType: 'audio/wav',
      originalName: 'audio.wav',
      storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentHash: audioHash,
      hashAlgorithm: 'SHA-256',
      metadata: { source: 'microphone', confidence: 0.91 },
    });
    expect(createArgs.data.hashedAt).toBeInstanceOf(Date);
    expect(tx.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.EVIDENCE_UPLOADED,
        message: 'Evidence uploaded.',
        metadata: {
          evidenceRecordId: 'evidence-id',
          evidenceType: EvidenceType.AUDIO,
          mimeType: 'audio/wav',
          size: audioBuffer.byteLength,
          contentHash: audioHash,
          hashAlgorithm: 'SHA-256',
          clientUploadId: null,
          chunkSequenceId: null,
          chunkIndex: null,
          chunkChainStatus: EvidenceChunkChainStatus.NOT_APPLICABLE,
        },
      },
    });
    expect(tx.evidenceAuditEvent.findFirst).toHaveBeenCalledWith({
      where: { evidenceRecordId: 'evidence-id' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { eventHash: true },
    });

    const auditCreateArgs = tx.evidenceAuditEvent.create.mock.calls[0]?.[0];

    if (!auditCreateArgs) {
      throw new Error('Expected evidence audit event create call');
    }

    expect(auditCreateArgs.data).toMatchObject({
      userId: 'user-id',
      evidenceRecordId: 'evidence-id',
      action: EvidenceAuditAction.UPLOADED,
      contentHash: audioHash,
      hashAlgorithm: 'SHA-256',
      metadata: {
        alertSessionId: 'session-id',
        evidenceType: EvidenceType.AUDIO,
        mimeType: 'audio/wav',
        size: audioBuffer.byteLength,
        clientUploadId: null,
        chunkSequenceId: null,
        chunkIndex: null,
        previousChunkHash: null,
        chunkChainStatus: EvidenceChunkChainStatus.NOT_APPLICABLE,
      },
    });
    expect(auditCreateArgs.data.eventHash).toHaveLength(64);
    expect(result).not.toHaveProperty('storagePath');
    expect(result.contentHash).toBe(audioHash);
    expect(result.hashAlgorithm).toBe('SHA-256');
    expect(result.id).toBe('evidence-id');
  });

  it('lists only visible evidence records for a user-owned session', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.evidenceRecord.findMany.mockResolvedValue([baseEvidence()]);

    const result = await service.findAll('user-id', 'session-id');

    expect(prisma.alertSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: 'user-id' },
    });
    expect(prisma.evidenceRecord.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        hiddenFromUserAt: null,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('storagePath');
    expect(result[0]?.hiddenFromUserAt).toBeNull();
  });

  it('hides evidence from the user without deleting it from storage', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());

    const result = await service.hideFromUser(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(prisma.evidenceRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'evidence-id',
        userId: 'user-id',
        alertSessionId: 'session-id',
        deletedAt: null,
      },
    });
    expect(tx.evidenceRecord.update).toHaveBeenCalledTimes(1);

    const updateArgs = tx.evidenceRecord.update.mock.calls[0]?.[0];

    if (!updateArgs) {
      throw new Error('Expected evidence record update call');
    }

    expect(updateArgs.where).toEqual({ id: 'evidence-id' });
    expect(updateArgs.data.hiddenFromUserAt).toBeInstanceOf(Date);
    expect(updateArgs.data.retentionUntil).toBeInstanceOf(Date);
    expect(updateArgs.data.retentionUntil.getTime()).toBeGreaterThan(
      updateArgs.data.hiddenFromUserAt.getTime(),
    );

    const auditCreateArgs = tx.evidenceAuditEvent.create.mock.calls[0]?.[0];

    if (!auditCreateArgs) {
      throw new Error('Expected evidence hide audit event');
    }

    expect(auditCreateArgs.data).toMatchObject({
      userId: 'user-id',
      evidenceRecordId: 'evidence-id',
      action: EvidenceAuditAction.HIDDEN_FROM_USER,
      contentHash: audioHash,
      hashAlgorithm: 'SHA-256',
      metadata: {
        alertSessionId: 'session-id',
      },
    });
    expect(evidenceStorage.downloadEvidence).not.toHaveBeenCalled();
    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
    expect(result.hiddenFromUserAt).toBeInstanceOf(Date);
    expect(result.retentionUntil).toBeInstanceOf(Date);
  });

  it('does not create a new retention event for already hidden evidence', async () => {
    const hiddenFromUserAt = new Date('2026-05-24T00:00:00.000Z');
    const retentionUntil = new Date('2026-11-20T00:00:00.000Z');
    prisma.evidenceRecord.findFirst.mockResolvedValue(
      baseEvidence({ hiddenFromUserAt, retentionUntil }),
    );

    const result = await service.hideFromUser(
      'user-id',
      'session-id',
      'evidence-id',
    );

    expect(tx.evidenceRecord.update).not.toHaveBeenCalled();
    expect(tx.evidenceAuditEvent.create).not.toHaveBeenCalled();
    expect(result.hiddenFromUserAt).toBe(hiddenFromUserAt);
    expect(result.retentionUntil).toBe(retentionUntil);
  });

  it('verifies a stored evidence file against its saved hash', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    prisma.evidenceAuditEvent.findFirst.mockResolvedValue({
      eventHash: 'b'.repeat(64),
    });

    const result = await service.verify('user-id', 'session-id', 'evidence-id');

    expect(prisma.evidenceRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'evidence-id',
        userId: 'user-id',
        alertSessionId: 'session-id',
        deletedAt: null,
      },
    });
    expect(evidenceStorage.downloadEvidence).toHaveBeenCalledWith(
      'users/user-id/alert-sessions/session-id/audio.wav',
    );
    expect(result).toMatchObject({
      evidenceRecordId: 'evidence-id',
      hashAlgorithm: 'SHA-256',
      storedHash: audioHash,
      calculatedHash: audioHash,
      matches: true,
    });

    const auditCreateArgs = prisma.evidenceAuditEvent.create.mock.calls[0]?.[0];

    if (!auditCreateArgs) {
      throw new Error('Expected evidence verification audit event');
    }

    expect(auditCreateArgs.data).toMatchObject({
      userId: 'user-id',
      evidenceRecordId: 'evidence-id',
      action: EvidenceAuditAction.HASH_VERIFIED,
      contentHash: audioHash,
      hashAlgorithm: 'SHA-256',
      previousEventHash: 'b'.repeat(64),
      metadata: {
        alertSessionId: 'session-id',
        matches: true,
        storedHash: audioHash,
      },
    });
    expect(auditCreateArgs.data.eventHash).toHaveLength(64);
  });

  it('returns a failed verification result when the storage hash differs', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(baseEvidence());
    evidenceStorage.downloadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: Buffer.byteLength('tampered'),
      body: toArrayBuffer(Buffer.from('tampered')),
    });

    const result = await service.verify('user-id', 'session-id', 'evidence-id');

    expect(result.matches).toBe(false);
    expect(result.storedHash).toBe(audioHash);
    expect(result.calculatedHash).toBe(hashBuffer(Buffer.from('tampered')));
    expect(prisma.evidenceAuditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects evidence for sessions from another user', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(null);

    await expect(
      service.upload(
        'user-id',
        'other-session-id',
        {
          type: EvidenceType.AUDIO,
        },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('rejects evidence uploads for closed alert sessions', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(
      baseSession({ status: AlertStatus.RESOLVED }),
    );

    await expect(
      service.upload(
        'user-id',
        'session-id',
        { type: EvidenceType.AUDIO },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('rejects mismatched evidence type and mime type', async () => {
    await expect(
      service.upload(
        'user-id',
        'session-id',
        { type: EvidenceType.IMAGE },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.alertSession.findFirst).not.toHaveBeenCalled();
  });

  it('rejects oversized files before uploading to storage', async () => {
    await expect(
      service.upload(
        'user-id',
        'session-id',
        { type: EvidenceType.AUDIO },
        audioFile({ size: 25 * 1024 * 1024 + 1 }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('rejects invalid metadata JSON', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    await expect(
      service.upload(
        'user-id',
        'session-id',
        { type: EvidenceType.AUDIO, metadata: '{broken' },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('accepts extended Vera audio chunk metadata', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.evidenceRecord.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        baseEvidence({
          id: 'previous-evidence-id',
          contentHash: 'b'.repeat(64),
          chunkSequenceId: 'vera-audio-20260603T120000Z',
          chunkIndex: 2,
          chunkChainStatus: EvidenceChunkChainStatus.ROOT,
        }),
      );

    await service.upload(
      'user-id',
      'session-id',
      {
        type: EvidenceType.AUDIO,
        metadata: JSON.stringify({
          accuracyMeters: 8,
          audioChunkDurationMs: 8000,
          audioChunkHash: audioHash,
          audioChunkIndex: 3,
          audioChunkSequenceId: 'vera-audio-20260603T120000Z',
          audioLoudSampleRatio: 0.44,
          audioMaxMeteringDb: -18.3,
          audioMeanMeteringDb: -31.4,
          audioPreviousChunkHash: 'b'.repeat(64),
          audioSentinelConfidence: 0.82,
          audioSentinelSampleCount: 16,
          captureEndedAt: '2026-06-03T12:00:24.000Z',
          captureStartedAt: '2026-06-03T12:00:16.000Z',
          capturedAt: '2026-06-03T12:00:21.000Z',
          foreground: false,
          latitude: -3.7319,
          locationSource: 'background',
          longitude: -38.5267,
          platform: 'android',
          postRollMs: 0,
          preRollMs: 8000,
          source: 'audio_sentinel',
          triggeredAt: '2026-06-03T12:00:24.000Z',
          triggerReasons: 'sustained_loud_audio,volume_spike',
        }),
      },
      audioFile(),
    );

    const createArgs = tx.evidenceRecord.create.mock.calls[0]?.[0];

    expect(createArgs?.data.metadata).toMatchObject({
      audioChunkHash: audioHash,
      audioPreviousChunkHash: 'b'.repeat(64),
      audioChunkSequenceId: 'vera-audio-20260603T120000Z',
    });
    expect(createArgs?.data).toMatchObject({
      chunkSequenceId: 'vera-audio-20260603T120000Z',
      chunkIndex: 3,
      previousChunkHash: 'b'.repeat(64),
      chunkChainStatus: EvidenceChunkChainStatus.VERIFIED,
    });
  });

  it('returns the existing record when a queued upload is retried', async () => {
    const existing = baseEvidence({ clientUploadId: 'queue-id' });
    prisma.evidenceRecord.findFirst.mockResolvedValue(existing);

    const result = await service.upload(
      'user-id',
      'session-id',
      {
        type: EvidenceType.AUDIO,
        metadata: JSON.stringify({ queuedEvidenceUploadId: 'queue-id' }),
      },
      audioFile(),
    );

    expect(result.id).toBe(existing.id);
    expect(prisma.alertSession.findFirst).not.toHaveBeenCalled();
    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
    expect(tx.evidenceRecord.create).not.toHaveBeenCalled();
  });

  it('rejects a queued upload identifier reused for different content', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(
      baseEvidence({
        clientUploadId: 'queue-id',
        contentHash: 'c'.repeat(64),
      }),
    );

    await expect(
      service.upload(
        'user-id',
        'session-id',
        {
          type: EvidenceType.AUDIO,
          metadata: JSON.stringify({ queuedEvidenceUploadId: 'queue-id' }),
        },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('rejects audio chunk metadata with a hash that differs from the file', async () => {
    await expect(
      service.upload(
        'user-id',
        'session-id',
        {
          type: EvidenceType.AUDIO,
          metadata: JSON.stringify({
            audioChunkHash: 'a'.repeat(64),
            audioChunkIndex: 1,
            audioChunkSequenceId: 'sequence-id',
            audioPreviousChunkHash: null,
          }),
        },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.evidenceRecord.findFirst).not.toHaveBeenCalled();
    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('stores the first audio chunk in a sequence as a root', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(null);
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    await service.upload(
      'user-id',
      'session-id',
      {
        type: EvidenceType.AUDIO,
        metadata: JSON.stringify({
          audioChunkHash: audioHash,
          audioChunkIndex: 7,
          audioChunkSequenceId: 'sequence-id',
          audioPreviousChunkHash: null,
        }),
      },
      audioFile(),
    );

    expect(tx.evidenceRecord.create.mock.calls[0]?.[0].data).toMatchObject({
      chunkSequenceId: 'sequence-id',
      chunkIndex: 7,
      previousChunkHash: null,
      chunkChainStatus: EvidenceChunkChainStatus.ROOT,
    });
  });

  it('stores an out-of-order audio chunk as pending previous', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(null);
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    await service.upload(
      'user-id',
      'session-id',
      {
        type: EvidenceType.AUDIO,
        metadata: JSON.stringify({
          audioChunkHash: audioHash,
          audioChunkIndex: 8,
          audioChunkSequenceId: 'sequence-id',
          audioPreviousChunkHash: 'b'.repeat(64),
        }),
      },
      audioFile(),
    );

    expect(tx.evidenceRecord.create.mock.calls[0]?.[0].data).toMatchObject({
      chunkChainStatus: EvidenceChunkChainStatus.PENDING_PREVIOUS,
    });
  });

  it('rejects an audio chunk whose previous hash disagrees with the preceding chunk', async () => {
    prisma.evidenceRecord.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        baseEvidence({
          contentHash: 'c'.repeat(64),
          chunkSequenceId: 'sequence-id',
          chunkIndex: 7,
        }),
      );
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    await expect(
      service.upload(
        'user-id',
        'session-id',
        {
          type: EvidenceType.AUDIO,
          metadata: JSON.stringify({
            audioChunkHash: audioHash,
            audioChunkIndex: 8,
            audioChunkSequenceId: 'sequence-id',
            audioPreviousChunkHash: 'b'.repeat(64),
          }),
        },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });

  it('reconciles a pending child when its previous chunk arrives', async () => {
    prisma.evidenceRecord.findFirst.mockResolvedValue(null);
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    const pendingChild = baseEvidence({
      id: 'pending-child-id',
      contentHash: 'c'.repeat(64),
      chunkSequenceId: 'sequence-id',
      chunkIndex: 8,
      previousChunkHash: audioHash,
      chunkChainStatus: EvidenceChunkChainStatus.PENDING_PREVIOUS,
    });
    tx.evidenceRecord.findFirst.mockResolvedValue(pendingChild);
    tx.evidenceRecord.update.mockResolvedValue(
      baseEvidence({
        ...pendingChild,
        chunkChainStatus: EvidenceChunkChainStatus.VERIFIED,
      }),
    );

    await service.upload(
      'user-id',
      'session-id',
      {
        type: EvidenceType.AUDIO,
        metadata: JSON.stringify({
          audioChunkHash: audioHash,
          audioChunkIndex: 7,
          audioChunkSequenceId: 'sequence-id',
          audioPreviousChunkHash: null,
        }),
      },
      audioFile(),
    );

    expect(tx.evidenceRecord.update).toHaveBeenCalledWith({
      where: { id: 'pending-child-id' },
      data: { chunkChainStatus: EvidenceChunkChainStatus.VERIFIED },
    });
    const chainAuditArgs = tx.evidenceAuditEvent.create.mock.calls.at(-1)?.[0];

    if (!chainAuditArgs) {
      throw new Error('Expected chunk chain audit event');
    }

    expect(chainAuditArgs.data).toMatchObject({
      evidenceRecordId: 'pending-child-id',
      action: EvidenceAuditAction.CHUNK_CHAIN_VERIFIED,
      metadata: {
        previousEvidenceRecordId: 'evidence-id',
        chunkChainStatus: EvidenceChunkChainStatus.VERIFIED,
      },
    });
  });

  it('rejects metadata above the extended key limit', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());

    await expect(
      service.upload(
        'user-id',
        'session-id',
        {
          type: EvidenceType.AUDIO,
          metadata: JSON.stringify(
            Object.fromEntries(
              Array.from({ length: 33 }, (_, index) => [`key${index}`, index]),
            ),
          ),
        },
        audioFile(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evidenceStorage.uploadEvidence).not.toHaveBeenCalled();
  });
});
