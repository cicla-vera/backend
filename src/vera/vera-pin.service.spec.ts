import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SafetyProfile } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { VeraPinService } from './vera-pin.service';

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
        data: {
          pinHash: string;
          pinUpdatedAt: Date;
        };
      },
    ]
  >;
};

type JwtServiceMock = {
  sign: jest.Mock<string, [Record<string, string>, { expiresIn: number }]>;
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

describe('VeraPinService', () => {
  let service: VeraPinService;
  let safetyProfile: SafetyProfileDelegateMock;
  let jwt: JwtServiceMock;

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
            data: {
              pinHash: string;
              pinUpdatedAt: Date;
            };
          },
        ]
      >(),
    };
    jwt = {
      sign: jest.fn<string, [Record<string, string>, { expiresIn: number }]>(),
    };

    const prisma = { safetyProfile } as unknown as PrismaService;
    service = new VeraPinService(prisma, jwt as unknown as JwtService);
  });

  it('sets a new Vera PIN without returning the hash', async () => {
    safetyProfile.upsert.mockResolvedValue(baseProfile());
    safetyProfile.update.mockImplementation(({ data }) => {
      return Promise.resolve(
        baseProfile({
          pinHash: data.pinHash,
          pinUpdatedAt: data.pinUpdatedAt,
        }),
      );
    });

    const result = await service.setPin('user-id', { pin: '123456' });

    expect(safetyProfile.update).toHaveBeenCalledTimes(1);
    expect(result.pinConfigured).toBe(true);
    expect(result.pinUpdatedAt).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty('pinHash');
  });

  it('requires the current PIN before changing an existing PIN', async () => {
    safetyProfile.upsert.mockResolvedValue(
      baseProfile({ pinHash: 'existing-hash' }),
    );

    await expect(
      service.setPin('user-id', { pin: '654321' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(safetyProfile.update).not.toHaveBeenCalled();
  });

  it('verifies a correct PIN and returns a temporary Vera session token', async () => {
    const pinHash = await bcrypt.hash('123456', 1);
    const pinUpdatedAt = new Date('2026-05-24T00:00:00.000Z');

    safetyProfile.upsert.mockResolvedValue(
      baseProfile({ pinHash, pinUpdatedAt }),
    );
    jwt.sign.mockReturnValue('vera-session-token');

    const result = await service.verifyPin('user-id', { pin: '123456' });

    expect(jwt.sign).toHaveBeenCalledWith(
      {
        sub: 'user-id',
        scope: 'vera',
        kind: 'vera-session',
      },
      { expiresIn: 600 },
    );
    expect(result.verified).toBe(true);
    expect(result.veraSessionToken).toBe('vera-session-token');
    expect(result.pinUpdatedAt).toEqual(pinUpdatedAt);
    expect(result).not.toHaveProperty('pinHash');
  });

  it('rejects an incorrect PIN with a generic unauthorized error', async () => {
    const pinHash = await bcrypt.hash('123456', 1);
    safetyProfile.upsert.mockResolvedValue(baseProfile({ pinHash }));

    await expect(
      service.verifyPin('user-id', { pin: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('locks verification after repeated invalid PIN attempts', async () => {
    const pinHash = await bcrypt.hash('123456', 1);
    safetyProfile.upsert.mockResolvedValue(baseProfile({ pinHash }));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.verifyPin('user-id', { pin: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    try {
      await service.verifyPin('user-id', { pin: '123456' });
      throw new Error('Expected Vera PIN verification to be locked');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);

      if (error instanceof HttpException) {
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  });
});
