import { BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  cycleLog: {
    findMany: jest.Mock;
  };
  notificationDelivery: {
    create: jest.Mock;
    findUnique: jest.Mock;
  };
  notificationDevice: {
    deleteMany: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
  notificationSettings: {
    upsert: jest.Mock;
  };
};

type ExpoPushRequestMessage = {
  body: string;
  data: Record<string, string>;
  sound: 'default';
  title: string;
  to: string;
};

const enabledDevice = (overrides: Record<string, unknown> = {}) => ({
  createdAt: new Date('2026-06-03T12:00:00.000Z'),
  enabled: true,
  id: 'device-id',
  lastSeenAt: new Date('2026-06-03T12:00:00.000Z'),
  platform: 'android',
  token: 'ExpoPushToken[device-token]',
  updatedAt: new Date('2026-06-03T12:00:00.000Z'),
  userId: 'user-id',
  ...overrides,
});

const settings = (overrides: Record<string, unknown> = {}) => ({
  createdAt: new Date('2026-06-03T12:00:00.000Z'),
  id: 'settings-id',
  medicationReminder: false,
  ovulationReminder: false,
  periodReminder: false,
  reminderHour: 0,
  updatedAt: new Date('2026-06-03T12:00:00.000Z'),
  userId: 'user-id',
  waterReminder: false,
  ...overrides,
});

describe('NotificationsService', () => {
  let fetchMock: jest.Mock;
  let prisma: PrismaMock;
  let service: NotificationsService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    prisma = {
      cycleLog: {
        findMany: jest.fn(),
      },
      notificationDelivery: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      notificationDevice: {
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
      notificationSettings: {
        upsert: jest.fn(),
      },
    };
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it('rejects invalid Expo push tokens during registration', async () => {
    await expect(
      service.registerDevice('user-id', {
        platform: 'android',
        token: 'invalid-token',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.notificationDevice.upsert).not.toHaveBeenCalled();
  });

  it('sends a Portuguese test notification and disables unregistered devices', async () => {
    prisma.notificationDevice.findMany.mockResolvedValue([
      enabledDevice({ id: 'device-ok', token: 'ExpoPushToken[ok]' }),
      enabledDevice({ id: 'device-stale', token: 'ExpoPushToken[stale]' }),
    ]);
    fetchMock.mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        data: [
          { id: 'ticket-ok', status: 'ok' },
          {
            details: { error: 'DeviceNotRegistered' },
            message: 'Device is not registered.',
            status: 'error',
          },
        ],
      }),
      ok: true,
    });

    const result = await service.sendTest('user-id', {});
    const fetchCalls = fetchMock.mock.calls as Array<
      [unknown, { body?: unknown }]
    >;
    const fetchBody = fetchCalls[0]?.[1].body;

    if (typeof fetchBody !== 'string') {
      throw new Error('Expected Expo push request body');
    }

    const messages = JSON.parse(fetchBody) as ExpoPushRequestMessage[];

    expect(messages).toEqual([
      {
        body: 'Notificacoes do Cicla Vera estao funcionando.',
        data: { type: 'TEST_NOTIFICATION' },
        sound: 'default',
        title: 'Cicla Vera',
        to: 'ExpoPushToken[ok]',
      },
      {
        body: 'Notificacoes do Cicla Vera estao funcionando.',
        data: { type: 'TEST_NOTIFICATION' },
        sound: 'default',
        title: 'Cicla Vera',
        to: 'ExpoPushToken[stale]',
      },
    ]);
    expect(prisma.notificationDevice.updateMany).toHaveBeenCalledWith({
      data: { enabled: false },
      where: {
        id: { in: ['device-stale'] },
        userId: 'user-id',
      },
    });
    expect(result).toMatchObject({
      disabledDeviceCount: 1,
      failed: 1,
      sent: 1,
    });
  });

  it('sends due reminders once with Cicla copy', async () => {
    prisma.notificationSettings.upsert.mockResolvedValue(
      settings({ medicationReminder: true, waterReminder: true }),
    );
    prisma.cycleLog.findMany.mockResolvedValue([]);
    prisma.notificationDevice.findMany.mockResolvedValue([enabledDevice()]);
    prisma.notificationDelivery.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'already-sent-water' });
    fetchMock.mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        data: [{ id: 'ticket-ok', status: 'ok' }],
      }),
      ok: true,
    });

    const result = await service.sendDueReminders('user-id', {
      referenceDate: '2026-06-03T09:00:00.000Z',
    });
    const createCalls = prisma.notificationDelivery.create.mock.calls as Array<
      [
        {
          data?: {
            referenceDate?: unknown;
          };
        },
      ]
    >;
    const createCall = createCalls[0]?.[0];

    expect(createCall?.data?.referenceDate).toBeInstanceOf(Date);
    expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: 'Hora de conferir seus medicamentos de hoje.',
        title: 'Lembrete de medicamento',
        type: 'MEDICATION_REMINDER',
        userId: 'user-id',
      }) as Record<string, unknown>,
    });
    expect(result).toMatchObject({
      sent: 1,
      skipped: 1,
    });
    expect(result.results).toContainEqual({
      reason: 'Lembrete ja enviado nesta data.',
      status: 'skipped',
      type: 'WATER_REMINDER',
    });
  });

  it('rejects unexpected Expo push ticket counts', async () => {
    prisma.notificationDevice.findMany.mockResolvedValue([enabledDevice()]);
    fetchMock.mockResolvedValue({
      json: jest.fn().mockResolvedValue({ data: [] }),
      ok: true,
    });

    await expect(service.sendTest('user-id', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
