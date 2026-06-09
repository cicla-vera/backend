import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  SafetyLocationType,
  type AlertEvent,
  type AlertSession,
  type SafetyLocation,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertSessionsService } from './alert-sessions.service';

type AlertSessionWithEvents = AlertSession & {
  events: AlertEvent[];
};

type AlertEventCreateData = {
  userId: string;
  type: AlertEventType;
  message?: string;
  metadata: Record<string, string | number>;
  latitude?: number;
  longitude?: number;
};

type OrderedEventsInclude = {
  events: {
    orderBy: { createdAt: 'asc' };
  };
};

type AlertSessionCreateArgs = {
  data: {
    userId: string;
    trigger: AlertTrigger;
    level: AlertLevel;
    safetyLocationId?: string;
    initialLatitude?: number;
    initialLongitude?: number;
    events: {
      create: AlertEventCreateData | AlertEventCreateData[];
    };
  };
  include: OrderedEventsInclude;
};

type AlertSessionFindFirstArgs = {
  where: {
    id?: string;
    userId: string;
    status?: AlertStatus;
  };
  include: OrderedEventsInclude;
  orderBy?: { startedAt: 'desc' };
};

type AlertSessionUpdateArgs = {
  where: { id: string };
  data: {
    status: AlertStatus;
    endedAt: Date;
    events: {
      create: {
        userId: string;
        type: AlertEventType;
        message?: string;
        metadata: { status: AlertStatus };
      };
    };
  };
  include: OrderedEventsInclude;
};

type AlertSessionDelegateMock = {
  create: jest.Mock<Promise<AlertSessionWithEvents>, [AlertSessionCreateArgs]>;
  findFirst: jest.Mock<
    Promise<AlertSessionWithEvents | null>,
    [AlertSessionFindFirstArgs]
  >;
  update: jest.Mock<Promise<AlertSessionWithEvents>, [AlertSessionUpdateArgs]>;
};

type SafetyLocationDelegateMock = {
  findFirst: jest.Mock<
    Promise<SafetyLocation | null>,
    [
      {
        where: {
          id: string;
          userId: string;
          enabled: true;
        };
      },
    ]
  >;
};

const baseEvent = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'event-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: AlertEventType.SESSION_STARTED,
  message: null,
  metadata: null,
  latitude: null,
  longitude: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseSession = (
  overrides: Partial<AlertSessionWithEvents> = {},
): AlertSessionWithEvents => ({
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
  events: [baseEvent()],
  ...overrides,
});

const baseSafetyLocation = (
  overrides: Partial<SafetyLocation> = {},
): SafetyLocation => ({
  id: 'location-id',
  userId: 'user-id',
  name: 'Home',
  latitude: -3.7319,
  longitude: -38.5267,
  radiusMeters: 120,
  type: SafetyLocationType.RISK,
  enabled: true,
  address: null,
  formattedAddress: null,
  placeId: null,
  addressSource: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

describe('AlertSessionsService', () => {
  let service: AlertSessionsService;
  let alertSession: AlertSessionDelegateMock;
  let safetyLocation: SafetyLocationDelegateMock;

  beforeEach(() => {
    alertSession = {
      create: jest.fn<
        Promise<AlertSessionWithEvents>,
        [AlertSessionCreateArgs]
      >(),
      findFirst: jest.fn<
        Promise<AlertSessionWithEvents | null>,
        [AlertSessionFindFirstArgs]
      >(),
      update: jest.fn<
        Promise<AlertSessionWithEvents>,
        [AlertSessionUpdateArgs]
      >(),
    };
    safetyLocation = {
      findFirst: jest.fn<
        Promise<SafetyLocation | null>,
        [
          {
            where: {
              id: string;
              userId: string;
              enabled: true;
            };
          },
        ]
      >(),
    };

    const prisma = { alertSession, safetyLocation } as unknown as PrismaService;
    service = new AlertSessionsService(prisma);
  });

  it('starts a manual alert session at the normal level', async () => {
    alertSession.findFirst.mockResolvedValueOnce(null);
    alertSession.create.mockResolvedValue(baseSession());

    const result = await service.startManual('user-id', {
      initialLatitude: -3.7319,
      initialLongitude: -38.5267,
      message: 'Manual start',
    });

    expect(alertSession.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        trigger: AlertTrigger.MANUAL,
        level: AlertLevel.NORMAL,
        initialLatitude: -3.7319,
        initialLongitude: -38.5267,
        events: {
          create: {
            userId: 'user-id',
            type: AlertEventType.SESSION_STARTED,
            message: 'Manual start',
            metadata: { source: 'manual' },
            latitude: -3.7319,
            longitude: -38.5267,
          },
        },
      },
      include: {
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    expect(result.alreadyActive).toBe(false);
    expect(result.level).toBe(AlertLevel.NORMAL);
  });

  it('returns the active session instead of creating another one', async () => {
    alertSession.findFirst.mockResolvedValueOnce(baseSession());

    const result = await service.startManual('user-id', {});

    expect(alertSession.create).not.toHaveBeenCalled();
    expect(result.alreadyActive).toBe(true);
    expect(result.id).toBe('session-id');
  });

  it('starts a location alert session with a monitored location snapshot', async () => {
    safetyLocation.findFirst.mockResolvedValue(baseSafetyLocation());
    alertSession.findFirst.mockResolvedValueOnce(null);
    alertSession.create.mockResolvedValue(
      baseSession({
        safetyLocationId: 'location-id',
        trigger: AlertTrigger.LOCATION,
        initialLatitude: -3.7319,
        initialLongitude: -38.5267,
        events: [
          baseEvent(),
          baseEvent({
            id: 'location-event-id',
            type: AlertEventType.LOCATION_ENTERED,
          }),
        ],
      }),
    );

    const result = await service.startLocation('user-id', {
      safetyLocationId: 'location-id',
      currentLatitude: -3.7319,
      currentLongitude: -38.5267,
      message: 'Entered monitored area',
    });

    expect(safetyLocation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'location-id',
        userId: 'user-id',
        enabled: true,
      },
    });
    expect(alertSession.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        safetyLocationId: 'location-id',
        trigger: AlertTrigger.LOCATION,
        level: AlertLevel.NORMAL,
        initialLatitude: -3.7319,
        initialLongitude: -38.5267,
        events: {
          create: [
            {
              userId: 'user-id',
              type: AlertEventType.SESSION_STARTED,
              message: 'Entered monitored area',
              metadata: {
                source: 'location',
                safetyLocationId: 'location-id',
              },
              latitude: -3.7319,
              longitude: -38.5267,
            },
            {
              userId: 'user-id',
              type: AlertEventType.LOCATION_ENTERED,
              message: 'Entered monitored area',
              metadata: {
                safetyLocationId: 'location-id',
                safetyLocationName: 'Home',
                safetyLocationType: SafetyLocationType.RISK,
                radiusMeters: 120,
              },
              latitude: -3.7319,
              longitude: -38.5267,
            },
          ],
        },
      },
      include: {
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    expect(result.alreadyActive).toBe(false);
    expect(result.trigger).toBe(AlertTrigger.LOCATION);
    expect(result.safetyLocationId).toBe('location-id');
  });

  it('rejects location starts for disabled or unknown user locations', async () => {
    safetyLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.startLocation('user-id', {
        safetyLocationId: 'location-id',
        currentLatitude: -3.7319,
        currentLongitude: -38.5267,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(alertSession.create).not.toHaveBeenCalled();
  });

  it('rejects coordinates sent without a matching pair', async () => {
    await expect(
      service.startManual('user-id', { initialLatitude: -3.7319 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when a session does not belong to the user', async () => {
    alertSession.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.findOne('user-id', 'other-session-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('closes an active session as resolved', async () => {
    alertSession.findFirst.mockResolvedValueOnce(baseSession());
    alertSession.update.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseSession({
          status: data.status,
          endedAt: data.endedAt,
          events: [
            baseEvent(),
            baseEvent({
              id: 'closed-event-id',
              type: AlertEventType.SESSION_CLOSED,
              message: data.events.create.message ?? null,
            }),
          ],
        }),
      );
    });

    const result = await service.close('user-id', 'session-id', {
      status: AlertStatus.RESOLVED,
      message: 'Safe now',
    });

    expect(alertSession.update).toHaveBeenCalledTimes(1);

    const updateArgs = alertSession.update.mock.calls[0]?.[0];

    if (!updateArgs) {
      throw new Error('Expected alert session update call');
    }

    expect(updateArgs.where).toEqual({ id: 'session-id' });
    expect(updateArgs.data.status).toBe(AlertStatus.RESOLVED);
    expect(updateArgs.data.endedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.events.create).toEqual({
      userId: 'user-id',
      type: AlertEventType.SESSION_CLOSED,
      message: 'Safe now',
      metadata: { status: AlertStatus.RESOLVED },
    });
    expect(result.status).toBe(AlertStatus.RESOLVED);
    expect(result.alreadyActive).toBe(false);
  });

  it('rejects closing a session with active status', async () => {
    await expect(
      service.close('user-id', 'session-id', { status: AlertStatus.ACTIVE }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
