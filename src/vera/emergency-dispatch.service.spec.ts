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
import {
  type EmergencyDeliveryChannel,
  MessagingProviderService,
  type SendMessageInput,
  type SendMessageResult,
} from './messaging-provider.service';

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

type AlertEventFindManyArgs = {
  where: {
    userId: string;
    alertSessionId: string;
    type: {
      in: AlertEventType[];
    };
  };
  orderBy: { createdAt: 'asc' };
};

type AlertEventFindFirstArgs = {
  where: {
    userId: string;
    alertSessionId: string;
    latitude: { not: null };
    longitude: { not: null };
  };
  orderBy: { createdAt: 'desc' };
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
    findMany: jest.Mock<Promise<AlertEvent[]>, [AlertEventFindManyArgs]>;
    findFirst: jest.Mock<Promise<AlertEvent | null>, [AlertEventFindFirstArgs]>;
    create: jest.Mock<Promise<AlertEvent>, [AlertEventCreateArgs]>;
  };
};

type MessagingProviderMock = {
  getEmergencyDispatchChannels: jest.Mock<EmergencyDeliveryChannel[], []>;
  sendMessage: jest.Mock<Promise<SendMessageResult>, [SendMessageInput]>;
};

const failedDelivery = (
  overrides: Partial<SendMessageResult> = {},
): SendMessageResult => ({
  channel: 'sms',
  provider: 'unconfigured',
  status: 'failed',
  failureReason: 'sms_provider_not_configured',
  ...overrides,
});

const sentDelivery = (
  overrides: Partial<SendMessageResult> = {},
): SendMessageResult => ({
  channel: 'sms',
  provider: 'mock',
  status: 'sent',
  providerMessageId: 'mock-message-id',
  ...overrides,
});

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

const emergencyMessage =
  'Alerta Vera: Ana pode estar em perigo agora. Local aproximado: -3.732, -38.527. Tente contato imediatamente e acione a policia ou emergencia local se nao conseguir confirmar que ela esta segura.';

describe('EmergencyDispatchService', () => {
  let service: EmergencyDispatchService;
  let prisma: PrismaMock;
  let messagingProvider: MessagingProviderMock;

  beforeEach(() => {
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
        findMany: jest.fn<Promise<AlertEvent[]>, [AlertEventFindManyArgs]>(),
        findFirst: jest.fn<
          Promise<AlertEvent | null>,
          [AlertEventFindFirstArgs]
        >(),
        create: jest.fn<Promise<AlertEvent>, [AlertEventCreateArgs]>(),
      },
    };
    messagingProvider = {
      getEmergencyDispatchChannels: jest.fn<EmergencyDeliveryChannel[], []>(),
      sendMessage: jest.fn<Promise<SendMessageResult>, [SendMessageInput]>(),
    };
    prisma.alertEvent.findMany.mockResolvedValue([]);
    prisma.alertEvent.findFirst.mockResolvedValue(null);
    prisma.alertEvent.create.mockResolvedValue(baseEvent());
    messagingProvider.getEmergencyDispatchChannels.mockReturnValue(['sms']);
    messagingProvider.sendMessage.mockResolvedValue(failedDelivery());
    service = new EmergencyDispatchService(
      prisma as unknown as PrismaService,
      messagingProvider as unknown as MessagingProviderService,
    );
  });

  it('creates failed dispatch attempts when the SMS provider fails safely', async () => {
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
    expect(messagingProvider.sendMessage).toHaveBeenNthCalledWith(1, {
      body: emergencyMessage,
      channel: 'sms',
      to: '+5585999999999',
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
          dispatchKind: 'critical_alert_contacts',
          dispatchSource: 'manual',
          deliveryChannel: 'sms',
          deliveryChannels: 'sms',
          deliveryStatusSms: 'failed',
          provider: 'unconfigured',
          providerSms: 'unconfigured',
          reason: 'sms_provider_not_configured',
          reasonSms: 'sms_provider_not_configured',
          status: 'failed',
          message: emergencyMessage,
        },
      },
    });
    expect(result.alreadyDispatched).toBe(false);
    expect(result.providerConfigured).toBe(false);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({
      contactId: 'contact-low',
      contactName: 'Bea',
      maskedPhone: '*********9999',
      deliveryChannel: 'sms',
      status: 'failed',
      provider: 'unconfigured',
      reason: 'sms_provider_not_configured',
    });
  });

  it('records a notified event when the SMS provider reports success', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([baseContact()]);
    messagingProvider.sendMessage.mockResolvedValue(sentDelivery());

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
          dispatchKind: 'critical_alert_contacts',
          dispatchSource: 'manual',
          deliveryChannel: 'sms',
          deliveryChannels: 'sms',
          deliveryStatusSms: 'sent',
          provider: 'mock',
          providerMessageId: 'mock-message-id',
          providerMessageIdSms: 'mock-message-id',
          providerSms: 'mock',
          status: 'sent',
          message: emergencyMessage,
        },
      },
    });
    expect(result.alreadyDispatched).toBe(false);
    expect(result.providerConfigured).toBe(true);
    expect(result.attempts[0]).toMatchObject({
      deliveryChannel: 'sms',
      eventType: AlertEventType.CONTACT_NOTIFIED,
      provider: 'mock',
      providerMessageId: 'mock-message-id',
      status: 'sent',
    });
  });

  it('dispatches configured SMS and WhatsApp channels as one contact notification', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([baseContact()]);
    messagingProvider.getEmergencyDispatchChannels.mockReturnValue([
      'sms',
      'whatsapp',
    ]);
    messagingProvider.sendMessage.mockImplementation((input) =>
      Promise.resolve(
        input.channel === 'sms'
          ? sentDelivery({
              channel: 'sms',
              provider: 'mock',
              providerMessageId: 'sms-message-id',
            })
          : failedDelivery({
              channel: 'whatsapp',
              provider: 'twilio',
              failureReason: 'twilio_http_400',
            }),
      ),
    );

    const result = await service.dispatchCriticalAlert('user-id', 'session-id');

    expect(messagingProvider.sendMessage).toHaveBeenNthCalledWith(1, {
      body: emergencyMessage,
      channel: 'sms',
      to: '+5585999999999',
    });
    expect(messagingProvider.sendMessage).toHaveBeenNthCalledWith(2, {
      body: emergencyMessage,
      channel: 'whatsapp',
      to: '+5585999999999',
    });
    expect(prisma.alertEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        alertSessionId: 'session-id',
        type: AlertEventType.CONTACT_NOTIFIED,
        message: 'Emergency contact notification prepared.',
        metadata: {
          contactId: 'contact-id',
          contactPriority: 0,
          deliveryChannel: 'multi',
          deliveryChannels: 'sms,whatsapp',
          deliveryStatusSms: 'sent',
          deliveryStatusWhatsapp: 'failed',
          dispatchKind: 'critical_alert_contacts',
          dispatchSource: 'manual',
          message: emergencyMessage,
          provider: 'mock',
          providerMessageId: 'sms-message-id',
          providerMessageIdSms: 'sms-message-id',
          providerSms: 'mock',
          providerWhatsapp: 'twilio',
          reasonWhatsapp: 'twilio_http_400',
          status: 'sent',
        },
      },
    });
    expect(result.providerConfigured).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        deliveryChannel: 'sms',
        status: 'sent',
      }),
      expect.objectContaining({
        deliveryChannel: 'whatsapp',
        reason: 'twilio_http_400',
        status: 'failed',
      }),
    ]);
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
        metadata: {
          dispatchKind: 'critical_alert_contacts',
          dispatchSource: 'manual',
          reason: 'no_active_contacts',
        },
      },
    });
    expect(result.alreadyDispatched).toBe(false);
    expect(result.attempts).toEqual([]);
  });

  it('does not duplicate notifications for contacts already notified', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([baseContact()]);
    prisma.alertEvent.findMany.mockResolvedValue([
      baseEvent({
        type: AlertEventType.CONTACT_NOTIFIED,
        metadata: {
          contactId: 'contact-id',
          message: emergencyMessage,
          provider: 'mock',
          providerMessageId: 'mock-message-id',
          status: 'sent',
        },
      }),
    ]);

    const result = await service.dispatchCriticalAlert('user-id', 'session-id');

    expect(messagingProvider.sendMessage).not.toHaveBeenCalled();
    expect(prisma.alertEvent.create).not.toHaveBeenCalled();
    expect(result.alreadyDispatched).toBe(true);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        contactId: 'contact-id',
        deliveryChannel: 'sms',
        eventType: AlertEventType.CONTACT_NOTIFIED,
        provider: 'mock',
        providerMessageId: 'mock-message-id',
        reason: 'already_notified',
        status: 'sent',
      }),
    ]);
  });

  it('uses the latest session location event when dispatching contacts', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([baseContact()]);
    prisma.alertEvent.findFirst.mockResolvedValue(
      baseEvent({
        latitude: -3.72,
        longitude: -38.51,
      }),
    );
    messagingProvider.sendMessage.mockResolvedValue(sentDelivery());

    await service.dispatchCriticalAlert('user-id', 'session-id', {
      source: 'ai_escalation',
    });

    expect(messagingProvider.sendMessage).toHaveBeenCalledWith({
      body: 'Alerta Vera: Ana pode estar em perigo agora. Local aproximado: -3.720, -38.510. Tente contato imediatamente e acione a policia ou emergencia local se nao conseguir confirmar que ela esta segura.',
      channel: 'sms',
      to: '+5585999999999',
    });
    expect(prisma.alertEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          dispatchSource: 'ai_escalation',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
  });

  it('does not duplicate the no-contact failure marker', async () => {
    prisma.alertSession.findFirst.mockResolvedValue(baseSession());
    prisma.emergencyContact.findMany.mockResolvedValue([]);
    prisma.alertEvent.findMany.mockResolvedValue([
      baseEvent({
        type: AlertEventType.CONTACT_NOTIFICATION_FAILED,
        metadata: {
          reason: 'no_active_contacts',
        },
      }),
    ]);

    const result = await service.dispatchCriticalAlert('user-id', 'session-id');

    expect(prisma.alertEvent.create).not.toHaveBeenCalled();
    expect(result.alreadyDispatched).toBe(true);
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
