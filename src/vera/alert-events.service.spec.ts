import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  type AlertEvent,
  type AlertSession,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertEventsService } from './alert-events.service';

type AlertSessionWithEvents = AlertSession & {
  events: AlertEvent[];
};

type OrderedEventsInclude = {
  events: {
    orderBy: { createdAt: 'asc' };
  };
};

type AlertSessionFindFirstArgs = {
  where: {
    id: string;
    userId: string;
  };
  include?: OrderedEventsInclude;
};

type AlertSessionUpdateArgs = {
  where: { id: string };
  data: {
    level: AlertLevel;
    criticalEscalatedAt: Date;
  };
};

type AlertEventCreateArgs = {
  data: {
    userId: string;
    alertSessionId: string;
    type: AlertEventType;
    message?: string;
    metadata?: Record<string, string | number | boolean | null>;
    latitude?: number;
    longitude?: number;
  };
};

type AlertSessionDelegateMock = {
  findFirst: jest.Mock<
    Promise<AlertSession | AlertSessionWithEvents | null>,
    [AlertSessionFindFirstArgs]
  >;
  update: jest.Mock<Promise<AlertSession>, [AlertSessionUpdateArgs]>;
};

type AlertEventDelegateMock = {
  create: jest.Mock<Promise<AlertEvent>, [AlertEventCreateArgs]>;
};

const baseEvent = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'event-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: AlertEventType.LOCATION_ENTERED,
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

describe('AlertEventsService', () => {
  let service: AlertEventsService;
  let alertSession: AlertSessionDelegateMock;
  let alertEvent: AlertEventDelegateMock;

  beforeEach(() => {
    alertSession = {
      findFirst: jest.fn<
        Promise<AlertSession | AlertSessionWithEvents | null>,
        [AlertSessionFindFirstArgs]
      >(),
      update: jest.fn<Promise<AlertSession>, [AlertSessionUpdateArgs]>(),
    };
    alertEvent = {
      create: jest.fn<Promise<AlertEvent>, [AlertEventCreateArgs]>(),
    };

    const prisma = { alertSession, alertEvent } as unknown as PrismaService;
    service = new AlertEventsService(prisma);
  });

  it('lists a user-owned session timeline ordered by creation date', async () => {
    alertSession.findFirst.mockResolvedValue(baseSession());

    const result = await service.findTimeline('user-id', 'session-id');

    expect(alertSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: 'user-id' },
      include: {
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    expect(result.alertSessionId).toBe('session-id');
    expect(result.events).toHaveLength(1);
  });

  it('creates a sanitized event on an active session', async () => {
    alertSession.findFirst.mockResolvedValue(baseSession());
    alertEvent.create.mockResolvedValue(
      baseEvent({
        type: AlertEventType.AI_ANALYSIS_COMPLETED,
        message: 'Analysis finished',
        metadata: { confidence: 0.88, riskLevel: 'normal' },
        latitude: -3.7319,
        longitude: -38.5267,
      }),
    );

    const result = await service.create('user-id', 'session-id', {
      type: AlertEventType.AI_ANALYSIS_COMPLETED,
      message: 'Analysis finished',
      metadata: { confidence: 0.88, riskLevel: 'normal' },
      latitude: -3.7319,
      longitude: -38.5267,
    });

    expect(alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.AI_ANALYSIS_COMPLETED,
        message: 'Analysis finished',
        metadata: { confidence: 0.88, riskLevel: 'normal' },
        latitude: -3.7319,
        longitude: -38.5267,
      },
    });
    expect(result.type).toBe(AlertEventType.AI_ANALYSIS_COMPLETED);
  });

  it('rejects events for sessions from another user', async () => {
    alertSession.findFirst.mockResolvedValue(null);

    await expect(
      service.create('user-id', 'other-session-id', {
        type: AlertEventType.EVIDENCE_UPLOADED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(alertEvent.create).not.toHaveBeenCalled();
  });

  it('rejects new events on closed sessions', async () => {
    alertSession.findFirst.mockResolvedValue(
      baseSession({ status: AlertStatus.RESOLVED }),
    );

    await expect(
      service.create('user-id', 'session-id', {
        type: AlertEventType.EVIDENCE_UPLOADED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(alertEvent.create).not.toHaveBeenCalled();
  });

  it('rejects incomplete coordinates', async () => {
    alertSession.findFirst.mockResolvedValue(baseSession());

    await expect(
      service.create('user-id', 'session-id', {
        type: AlertEventType.EVIDENCE_UPLOADED,
        latitude: -3.7319,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects metadata with too many keys', async () => {
    alertSession.findFirst.mockResolvedValue(baseSession());
    const metadata = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`key${index}`, index]),
    );

    await expect(
      service.create('user-id', 'session-id', {
        type: AlertEventType.EVIDENCE_UPLOADED,
        metadata,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates the session level when registering critical escalation', async () => {
    alertSession.findFirst.mockResolvedValue(baseSession());
    alertSession.update.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseSession({
          level: data.level,
          criticalEscalatedAt: data.criticalEscalatedAt,
        }),
      );
    });
    alertEvent.create.mockResolvedValue(
      baseEvent({ type: AlertEventType.ALERT_ESCALATED }),
    );

    await service.create('user-id', 'session-id', {
      type: AlertEventType.ALERT_ESCALATED,
      message: 'Critical risk detected',
      metadata: { riskLevel: 'critical' },
    });

    expect(alertSession.update).toHaveBeenCalledTimes(1);

    const updateArgs = alertSession.update.mock.calls[0]?.[0];

    if (!updateArgs) {
      throw new Error('Expected alert session update call');
    }

    expect(updateArgs.where).toEqual({ id: 'session-id' });
    expect(updateArgs.data.level).toBe(AlertLevel.CRITICAL);
    expect(updateArgs.data.criticalEscalatedAt).toBeInstanceOf(Date);
  });
});
