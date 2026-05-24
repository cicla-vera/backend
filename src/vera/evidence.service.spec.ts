import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  EvidenceType,
  type AlertEvent,
  type AlertSession,
  type EvidenceRecord,
} from '@prisma/client';
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
    metadata?: Record<string, string | number | boolean | null>;
  };
};

type AlertEventCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    type: AlertEventType;
    message: string;
    metadata: {
      evidenceRecordId: string;
      evidenceType: EvidenceType;
      mimeType: string;
      size: number;
    };
  };
};

type TransactionClientMock = {
  evidenceRecord: {
    create: jest.Mock<Promise<EvidenceRecord>, [EvidenceRecordCreateArgs]>;
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
  $transaction: jest.Mock<Promise<EvidenceRecord>, [TransactionCallback]>;
};

type EvidenceStorageMock = {
  uploadEvidence: jest.Mock<
    ReturnType<EvidenceStorageService['uploadEvidence']>,
    Parameters<EvidenceStorageService['uploadEvidence']>
  >;
};

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
  size: Buffer.byteLength('audio-bytes'),
  mimeType: 'audio/wav',
  originalName: 'audio.wav',
  storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
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
  buffer: Buffer.from('audio-bytes'),
  originalname: 'audio.wav',
  mimetype: 'audio/wav',
  size: Buffer.byteLength('audio-bytes'),
  ...overrides,
});

describe('EvidenceService', () => {
  let service: EvidenceService;
  let prisma: PrismaMock;
  let tx: TransactionClientMock;
  let evidenceStorage: EvidenceStorageMock;

  beforeEach(() => {
    tx = {
      evidenceRecord: {
        create: jest.fn<Promise<EvidenceRecord>, [EvidenceRecordCreateArgs]>(),
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
      $transaction: jest.fn<Promise<EvidenceRecord>, [TransactionCallback]>(),
    };
    evidenceStorage = {
      uploadEvidence: jest.fn<
        ReturnType<EvidenceStorageService['uploadEvidence']>,
        Parameters<EvidenceStorageService['uploadEvidence']>
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
          metadata: data.metadata ?? null,
        }),
      );
    });
    tx.alertEvent.create.mockResolvedValue(baseEvent());
    evidenceStorage.uploadEvidence.mockResolvedValue({
      bucket: 'vera-evidence',
      path: 'users/user-id/alert-sessions/session-id/audio.wav',
      contentType: 'audio/wav',
      size: Buffer.byteLength('audio-bytes'),
      uploadedAt: new Date('2026-05-24T00:00:00.000Z'),
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
      body: Buffer.from('audio-bytes'),
    });

    const createArgs = tx.evidenceRecord.create.mock.calls[0]?.[0];

    if (!createArgs) {
      throw new Error('Expected evidence record create call');
    }

    expect(createArgs.data).toMatchObject({
      userId: 'user-id',
      alertSessionId: 'session-id',
      type: EvidenceType.AUDIO,
      size: Buffer.byteLength('audio-bytes'),
      mimeType: 'audio/wav',
      originalName: 'audio.wav',
      storagePath: 'users/user-id/alert-sessions/session-id/audio.wav',
      metadata: { source: 'microphone', confidence: 0.91 },
    });
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
          size: Buffer.byteLength('audio-bytes'),
        },
      },
    });
    expect(result).not.toHaveProperty('storagePath');
    expect(result.id).toBe('evidence-id');
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
});
