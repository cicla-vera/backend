import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  EvidenceChunkChainStatus,
  LocationSampleSource,
  type AlertEvent,
  type AlertLocationSample,
  type AlertSession,
  type EvidenceRecord,
  EvidenceType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertLocationSamplesService } from './alert-location-samples.service';

type AlertSessionFindFirstArgs = {
  where: { id: string; userId: string };
};

type EvidenceRecordFindManyArgs = {
  where: {
    id: { in: string[] };
    userId: string;
    alertSessionId: string;
    deletedAt: null;
  };
};

type AlertLocationSampleFindFirstArgs = {
  where: { userId: string; alertSessionId: string };
  orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }];
};

type AlertLocationSampleFindManyArgs = {
  where: { userId: string; alertSessionId: string };
  orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }];
  take: number;
};

type AlertLocationSampleCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    evidenceRecordId?: string;
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    altitudeMeters?: number;
    speedMetersPerSecond?: number;
    headingDegrees?: number;
    source: LocationSampleSource;
    capturedAt: Date;
  };
};

type AlertEventCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    type: AlertEventType;
    message: string;
    latitude: number;
    longitude: number;
    metadata: Record<string, unknown>;
  };
};

type TransactionClientMock = {
  alertLocationSample: {
    create: jest.Mock<
      Promise<AlertLocationSample>,
      [AlertLocationSampleCreateArgs]
    >;
  };
  alertEvent: {
    create: jest.Mock<Promise<AlertEvent>, [AlertEventCreateArgs]>;
  };
};

type TransactionCallback = (
  tx: TransactionClientMock,
) => Promise<AlertLocationSample[]>;

type PrismaMock = {
  alertSession: {
    findFirst: jest.Mock<
      Promise<AlertSession | null>,
      [AlertSessionFindFirstArgs]
    >;
  };
  evidenceRecord: {
    findMany: jest.Mock<
      Promise<EvidenceRecord[]>,
      [EvidenceRecordFindManyArgs]
    >;
  };
  alertLocationSample: {
    findFirst: jest.Mock<
      Promise<AlertLocationSample | null>,
      [AlertLocationSampleFindFirstArgs]
    >;
    findMany: jest.Mock<
      Promise<AlertLocationSample[]>,
      [AlertLocationSampleFindManyArgs]
    >;
  };
  $transaction: jest.Mock<
    Promise<AlertLocationSample[]>,
    [TransactionCallback]
  >;
};

const baseSession = (overrides: Partial<AlertSession> = {}): AlertSession => ({
  id: 'session-id',
  userId: 'user-id',
  safetyLocationId: null,
  trigger: AlertTrigger.LOCATION,
  status: AlertStatus.ACTIVE,
  level: AlertLevel.NORMAL,
  startedAt: new Date('2026-05-29T02:00:00.000Z'),
  endedAt: null,
  criticalEscalatedAt: null,
  initialLatitude: -3.7319,
  initialLongitude: -38.5267,
  createdAt: new Date('2026-05-29T02:00:00.000Z'),
  updatedAt: new Date('2026-05-29T02:00:00.000Z'),
  ...overrides,
});

const baseLocationSample = (
  overrides: Partial<AlertLocationSample> = {},
): AlertLocationSample => ({
  id: 'location-sample-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  evidenceRecordId: null,
  latitude: -3.7319,
  longitude: -38.5267,
  accuracyMeters: 20,
  altitudeMeters: null,
  speedMetersPerSecond: null,
  headingDegrees: null,
  source: LocationSampleSource.FOREGROUND,
  capturedAt: new Date('2026-05-29T02:01:00.000Z'),
  metadata: null,
  createdAt: new Date('2026-05-29T02:01:01.000Z'),
  ...overrides,
});

const baseEvidenceRecord = (
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  id: 'evidence-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: EvidenceType.AUDIO,
  size: 1024,
  mimeType: 'audio/mp4',
  originalName: 'audio.m4a',
  storagePath: 'users/user-id/alert-sessions/session-id/audio.m4a',
  contentHash: 'hash',
  hashAlgorithm: 'SHA-256',
  hashedAt: new Date('2026-05-29T02:00:00.000Z'),
  clientUploadId: null,
  chunkSequenceId: null,
  chunkIndex: null,
  previousChunkHash: null,
  chunkChainStatus: EvidenceChunkChainStatus.NOT_APPLICABLE,
  hiddenFromUserAt: null,
  retentionUntil: null,
  deletedAt: null,
  metadata: null,
  createdAt: new Date('2026-05-29T02:00:00.000Z'),
  ...overrides,
});

const baseEvent = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'event-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: AlertEventType.LOCATION_UPDATED,
  message: 'Location updated during Vera monitoring.',
  metadata: null,
  latitude: -3.7319,
  longitude: -38.5267,
  createdAt: new Date('2026-05-29T02:01:01.000Z'),
  ...overrides,
});

describe('AlertLocationSamplesService', () => {
  let service: AlertLocationSamplesService;
  let prisma: PrismaMock;
  let tx: TransactionClientMock;

  beforeEach(() => {
    tx = {
      alertLocationSample: {
        create: jest.fn<
          Promise<AlertLocationSample>,
          [AlertLocationSampleCreateArgs]
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
        findMany: jest.fn<
          Promise<EvidenceRecord[]>,
          [EvidenceRecordFindManyArgs]
        >(),
      },
      alertLocationSample: {
        findFirst: jest.fn<
          Promise<AlertLocationSample | null>,
          [AlertLocationSampleFindFirstArgs]
        >(),
        findMany: jest.fn<
          Promise<AlertLocationSample[]>,
          [AlertLocationSampleFindManyArgs]
        >(),
      },
      $transaction: jest.fn<
        Promise<AlertLocationSample[]>,
        [TransactionCallback]
      >(),
    };

    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.evidenceRecord.findMany.mockResolvedValue([]);
    prisma.alertLocationSample.findFirst.mockResolvedValue(null);
    prisma.alertLocationSample.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    tx.alertLocationSample.create.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseLocationSample({
          alertSessionId: data.alertSessionId,
          evidenceRecordId: data.evidenceRecordId ?? null,
          latitude: data.latitude,
          longitude: data.longitude,
          accuracyMeters: data.accuracyMeters ?? null,
          altitudeMeters: data.altitudeMeters ?? null,
          speedMetersPerSecond: data.speedMetersPerSecond ?? null,
          headingDegrees: data.headingDegrees ?? null,
          source: data.source,
          capturedAt: data.capturedAt,
        }),
      );
    });
    tx.alertEvent.create.mockResolvedValue(baseEvent());

    service = new AlertLocationSamplesService(
      prisma as unknown as PrismaService,
    );
  });

  it('records a single foreground sample and emits the first location event', async () => {
    const result = await service.recordSamples('user-id', 'session-id', {
      accuracyMeters: 18,
      capturedAt: '2026-05-29T02:02:00.000Z',
      latitude: -3.7319,
      longitude: -38.5267,
      source: LocationSampleSource.FOREGROUND,
    });

    expect(prisma.alertSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: 'user-id' },
    });
    expect(tx.alertLocationSample.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        evidenceRecordId: undefined,
        latitude: -3.7319,
        longitude: -38.5267,
        accuracyMeters: 18,
        altitudeMeters: undefined,
        speedMetersPerSecond: undefined,
        headingDegrees: undefined,
        source: LocationSampleSource.FOREGROUND,
        capturedAt: new Date('2026-05-29T02:02:00.000Z'),
      },
    });
    expect(tx.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.LOCATION_UPDATED,
        message: 'Location updated during Vera monitoring.',
        latitude: -3.7319,
        longitude: -38.5267,
        metadata: {
          distanceFromPreviousMeters: null,
          locationSampleId: 'location-sample-id',
          source: LocationSampleSource.FOREGROUND,
        },
      },
    });
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toMatchObject({
      accuracyMeters: 18,
      source: LocationSampleSource.FOREGROUND,
    });
  });

  it('records a batch associated with owned evidence without emitting small movement events', async () => {
    prisma.alertLocationSample.findFirst.mockResolvedValue(
      baseLocationSample({
        latitude: -3.7319,
        longitude: -38.5267,
      }),
    );
    prisma.evidenceRecord.findMany.mockResolvedValue([baseEvidenceRecord()]);

    const result = await service.recordSamples('user-id', 'session-id', {
      samples: [
        {
          capturedAt: '2026-05-29T02:02:00.000Z',
          evidenceRecordId: 'evidence-id',
          latitude: -3.73191,
          longitude: -38.52671,
          source: LocationSampleSource.BACKGROUND,
        },
        {
          capturedAt: '2026-05-29T02:02:08.000Z',
          evidenceRecordId: 'evidence-id',
          latitude: -3.73192,
          longitude: -38.52672,
          source: LocationSampleSource.BACKGROUND,
        },
      ],
    });

    expect(prisma.evidenceRecord.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['evidence-id'] },
        userId: 'user-id',
        alertSessionId: 'session-id',
        deletedAt: null,
      },
    });
    expect(tx.alertLocationSample.create).toHaveBeenCalledTimes(2);
    expect(tx.alertEvent.create).not.toHaveBeenCalled();
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].evidenceRecordId).toBe('evidence-id');
  });

  it('emits a location event when movement crosses the significant threshold', async () => {
    prisma.alertLocationSample.findFirst.mockResolvedValue(
      baseLocationSample({
        latitude: -3.7319,
        longitude: -38.5267,
      }),
    );

    await service.recordSamples('user-id', 'session-id', {
      capturedAt: '2026-05-29T02:03:00.000Z',
      latitude: -3.72,
      longitude: -38.51,
    });

    expect(tx.alertEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: AlertEventType.LOCATION_UPDATED,
        metadata: expect.objectContaining({
          distanceFromPreviousMeters: expect.any(Number) as number,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
  });

  it('lists owned samples in chronological order with a safe limit', async () => {
    prisma.alertLocationSample.findMany.mockResolvedValue([
      baseLocationSample({
        id: 'newer',
        capturedAt: new Date('2026-05-29T02:02:00.000Z'),
      }),
      baseLocationSample({
        id: 'older',
        capturedAt: new Date('2026-05-29T02:01:00.000Z'),
      }),
    ]);

    const result = await service.findAll('user-id', 'session-id', '20');

    expect(prisma.alertLocationSample.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', alertSessionId: 'session-id' },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    });
    expect(result.map((sample) => sample.id)).toEqual(['older', 'newer']);
  });

  it('rejects samples for sessions from another user', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(null);

    await expect(
      service.recordSamples('user-id', 'other-session-id', {
        capturedAt: '2026-05-29T02:02:00.000Z',
        latitude: -3.7319,
        longitude: -38.5267,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects samples for closed sessions', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(
      baseSession({ status: AlertStatus.RESOLVED }),
    );

    await expect(
      service.recordSamples('user-id', 'session-id', {
        capturedAt: '2026-05-29T02:02:00.000Z',
        latitude: -3.7319,
        longitude: -38.5267,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects evidence ids outside the session', async () => {
    prisma.evidenceRecord.findMany.mockResolvedValue([]);

    await expect(
      service.recordSamples('user-id', 'session-id', {
        capturedAt: '2026-05-29T02:02:00.000Z',
        evidenceRecordId: 'evidence-id',
        latitude: -3.7319,
        longitude: -38.5267,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid list limits', async () => {
    await expect(
      service.findAll('user-id', 'session-id', 'zero'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
