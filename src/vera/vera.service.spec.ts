import { BadRequestException } from '@nestjs/common';
import type { SafetyProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VeraService } from './vera.service';

type SafetyProfileDelegateMock = {
  upsert: jest.Mock<
    Promise<SafetyProfile>,
    [
      {
        where: { userId: string };
        update: Record<string, never>;
        create: { userId: string };
      },
    ]
  >;
  update: jest.Mock<
    Promise<SafetyProfile>,
    [
      {
        where: { userId: string };
        data: Partial<SafetyProfile>;
      },
    ]
  >;
};

const baseProfile = (
  overrides: Partial<SafetyProfile> = {},
): SafetyProfile => ({
  id: 'profile-id',
  userId: 'user-id',
  veraEnabled: false,
  consentAccepted: false,
  consentAcceptedAt: null,
  pinHash: null,
  pinUpdatedAt: null,
  biometricUnlockEnabled: false,
  discreetNotificationsEnabled: true,
  monitoringEnabled: false,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

describe('VeraService', () => {
  let service: VeraService;
  let safetyProfile: SafetyProfileDelegateMock;

  beforeEach(() => {
    safetyProfile = {
      upsert: jest.fn<
        Promise<SafetyProfile>,
        [
          {
            where: { userId: string };
            update: Record<string, never>;
            create: { userId: string };
          },
        ]
      >(),
      update: jest.fn<
        Promise<SafetyProfile>,
        [
          {
            where: { userId: string };
            data: Partial<SafetyProfile>;
          },
        ]
      >(),
    };

    const prisma = { safetyProfile } as unknown as PrismaService;
    service = new VeraService(prisma);
  });

  it('gets or creates the profile without exposing the pin hash', async () => {
    safetyProfile.upsert.mockResolvedValue(
      baseProfile({ pinHash: 'hashed-pin' }),
    );

    const result = await service.getProfile('user-id');

    expect(safetyProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      update: {},
      create: { userId: 'user-id' },
    });
    expect(result.pinConfigured).toBe(true);
    expect(result).not.toHaveProperty('pinHash');
  });

  it('rejects Vera mode activation before consent is accepted', async () => {
    safetyProfile.upsert.mockResolvedValue(baseProfile());

    await expect(
      service.saveProfile('user-id', { monitoringEnabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(safetyProfile.update).not.toHaveBeenCalled();
  });

  it('accepts consent and enables monitoring safely', async () => {
    safetyProfile.upsert.mockResolvedValue(baseProfile());
    safetyProfile.update.mockImplementation(({ data }) => {
      return Promise.resolve(baseProfile(data));
    });

    const result = await service.saveProfile('user-id', {
      consentAccepted: true,
      monitoringEnabled: true,
    });

    expect(safetyProfile.update).toHaveBeenCalledTimes(1);

    const firstUpdateCall = safetyProfile.update.mock.calls[0];
    const updateArgs = firstUpdateCall?.[0];

    if (!updateArgs) {
      throw new Error('Expected safety profile update call');
    }

    expect(updateArgs.where).toEqual({ userId: 'user-id' });
    expect(updateArgs.data.consentAccepted).toBe(true);
    expect(updateArgs.data.consentAcceptedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.monitoringEnabled).toBe(true);
    expect(updateArgs.data.veraEnabled).toBe(true);
    expect(result.consentAccepted).toBe(true);
    expect(result.monitoringEnabled).toBe(true);
    expect(result.veraEnabled).toBe(true);
  });

  it('turns monitoring off when consent is revoked', async () => {
    safetyProfile.upsert.mockResolvedValue(
      baseProfile({
        consentAccepted: true,
        consentAcceptedAt: new Date('2026-05-24T00:00:00.000Z'),
        veraEnabled: true,
        monitoringEnabled: true,
      }),
    );
    safetyProfile.update.mockImplementation(({ data }) => {
      return Promise.resolve(baseProfile(data));
    });

    const result = await service.saveProfile('user-id', {
      consentAccepted: false,
    });

    expect(safetyProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: {
        consentAccepted: false,
        consentAcceptedAt: null,
        monitoringEnabled: false,
        veraEnabled: false,
      },
    });
    expect(result.consentAccepted).toBe(false);
    expect(result.monitoringEnabled).toBe(false);
    expect(result.veraEnabled).toBe(false);
  });
});
