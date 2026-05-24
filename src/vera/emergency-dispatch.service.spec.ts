import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  type AlertEvent,
  type AlertSession,
  type EmergencyContact,
  type Profile,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmergencyDispatchService } from './emergency-dispatch.service';

type AlertSessionWithProfile = AlertSession & {
  user: {
    profile: Profile | null;
  };
};

type AlertSessionFindFirstArgs = {
  where: { id: string; userId: string };
  include: {
    user: {
      select: {
        profile: true;
      };
    };
  };
};

type EmergencyContactFindManyArgs = {
  where: { userId: string; enabled: true };
  orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }];
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

type PrismaMock = {
  alertSession: {
    findFirst: jest.Mock<
      Promise<AlertSessionWithProfile | null>,
      [AlertSessionFindFirstArgs]
    >;
  };
  emergencyContact: {
    findMany: jest.Mock<
      Promise<EmergencyContact[]>,
      [EmergencyContactFindManyArgs]
    >;
  };
  alertEvent: {
    create: jest.Mock<Promise<AlertEvent>, [AlertEventCreateArgs]>;
  };
};

const baseProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'profile-id',
  userId: 'user-id',
  name: 'Ana',
  phone: null,
  birthDate: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseSession = (
  overrides: Partial<AlertSessionWithProfile> = {},
): AlertSessionWithProfile => ({
  id: 'session-id',
  userId: 'user-id',
  safetyLocationId: null,
  trigger: AlertTrigger.MANUAL,
  status: AlertStatus.ACTIVE,
  level: AlertLevel.CRITICAL,
  startedAt: new Date('2026-05-24T00:00:00.000Z'),
  endedAt: null,
  criticalEscalatedAt: new Date('2026-05-24T00:00:00.000Z'),
  initialLatitude: -3.7319,
  initialLongitude: -38.5267,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  user: { profile: baseProfile() },
  ...overrides,
});

const baseContact = (
  overrides: Partial<EmergencyContact> = {},
): EmergencyContact => ({
  id: 'contact-id',
  userId: 'user-id',
  name: 'Maria',
  phone: '+5585999999999',
  relationship: 'Sister',
  priority: 0,
  enabled: true,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

const baseEvent = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'event-id',
  userId: 'user-id',
  alertSessionId: 'session-id',
  type: AlertEventType.CONTACT_NOTIFICATION_FAILED,
  message: 'Emergency contact notification could not be sent.',
  metadata: null,
  latitude: null,
  longitude: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

describe('EmergencyDispatchService', () => {
  const originalEnv = process.env;
  let service: EmergencyDispatchService;
  let prisma: PrismaMock;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMERGENCY_CONTACT_DISPATCH_MODE: 'not_configured',
    };
    prisma = {
      alertSession: {
        findFirst: jest.fn<
          Promise<AlertSessionWithProfile | null>,
          [AlertSessionFindFirstArgs]
        >(),
      },
      emergencyContact: {
        findMany: jest.fn<
          Promise<EmergencyContact[]>,
          [EmergencyContactFindManyArgs]
        >(),
      },
      alertEvent: {
        create: jest.fn<Promise<AlertEvent>, [AlertEventCreateArgs]>(),
      },
    };
    prisma.alertEvent.create.mockResolvedValue(baseEvent());
    service = new EmergencyDispatchService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates failed dispatch attempts when delivery provider is not configured', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([
      baseContact({ id: 'contact-low', name: 'Bea', priority: 1 }),
      baseContact({ id: 'contact-high', name: 'Maria', priority: 0 }),
    ]);

    const result = await service.dispatchCriticalAlert('user-id', 'session-id');

    expect(prisma.alertSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-id', userId: 'user-id' },
      include: {
        user: {
          select: {
            profile: true,
          },
        },
      },
    });
    expect(prisma.emergencyContact.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    expect(prisma.alertEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.alertEvent.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.CONTACT_NOTIFICATION_FAILED,
        message: 'Emergency contact notification could not be sent.',
        metadata: {
          contactId: 'contact-low',
          contactPriority: 1,
          deliveryChannel: 'sms',
          provider: 'not_configured',
          reason: 'delivery_provider_not_configured',
          status: 'failed',
          message:
            'Ana may be in danger and needs help. Approximate location: -3.732, -38.527. Please try to contact her and call local emergency services if needed.',
        },
      },
    });
    expect(result.providerConfigured).toBe(false);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({
      contactId: 'contact-low',
      contactName: 'Bea',
      maskedPhone: '*********9999',
      status: 'failed',
      reason: 'delivery_provider_not_configured',
    });
  });

  it('records a notified event when mock dispatch mode is enabled', async () => {
    process.env.EMERGENCY_CONTACT_DISPATCH_MODE = 'mock';
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([baseContact()]);

    const result = await service.dispatchCriticalAlert('user-id', 'session-id');

    expect(prisma.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.CONTACT_NOTIFIED,
        message: 'Emergency contact notification prepared.',
        metadata: {
          contactId: 'contact-id',
          contactPriority: 0,
          deliveryChannel: 'sms',
          provider: 'mock',
          status: 'sent',
          message:
            'Ana may be in danger and needs help. Approximate location: -3.732, -38.527. Please try to contact her and call local emergency services if needed.',
        },
      },
    });
    expect(result.providerConfigured).toBe(true);
    expect(result.attempts[0]?.eventType).toBe(AlertEventType.CONTACT_NOTIFIED);
  });

  it('records a failed event when there are no active contacts', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([]);

    const result = await service.dispatchCriticalAlert('user-id', 'session-id');

    expect(prisma.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.CONTACT_NOTIFICATION_FAILED,
        message: 'No active emergency contacts configured.',
        metadata: { reason: 'no_active_contacts' },
      },
    });
    expect(result.attempts).toEqual([]);
  });

  it('rejects sessions from another user', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(null);

    await expect(
      service.dispatchCriticalAlert('user-id', 'other-session-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.emergencyContact.findMany).not.toHaveBeenCalled();
  });

  it('rejects non-critical alert sessions', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(
      baseSession({ level: AlertLevel.NORMAL }),
    );

    await expect(
      service.dispatchCriticalAlert('user-id', 'session-id'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.emergencyContact.findMany).not.toHaveBeenCalled();
  });

  it('rejects closed alert sessions', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(
      baseSession({ status: AlertStatus.RESOLVED }),
    );

    await expect(
      service.dispatchCriticalAlert('user-id', 'session-id'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.emergencyContact.findMany).not.toHaveBeenCalled();
  });
});
