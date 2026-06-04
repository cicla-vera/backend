import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

type PrismaMock = {
  profile: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
};

const verifiedAt = new Date('2026-06-01T12:00:00.000Z');
const baseProfile = {
  id: 'profile-id',
  userId: 'user-id',
  name: 'Ana',
  phone: '81999990000',
  phoneVerifiedAt: verifiedAt,
  birthDate: new Date('1995-03-10T00:00:00.000Z'),
  cpf: '52998224725',
  avgCycleLength: 28,
  avgPeriodDuration: 5,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};
const baseUser = {
  id: 'user-id',
  email: 'ana@example.com',
  password: 'hashed-password',
  emailVerifiedAt: verifiedAt,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  profile: baseProfile,
};

describe('UsersService', () => {
  let prisma: PrismaMock;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      profile: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(baseUser),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('returns persisted onboarding cycle averages in the profile', async () => {
    await expect(service.getMe('user-id')).resolves.toMatchObject({
      id: 'user-id',
      phone: '81999990000',
      cpf: '52998224725',
      avgCycleLength: 28,
      avgPeriodDuration: 5,
    });
  });

  it('normalizes profile data and persists cycle averages', async () => {
    prisma.profile.update.mockResolvedValue({
      ...baseProfile,
      name: 'Ana Maria',
      phone: '81988887777',
      phoneVerifiedAt: null,
      avgCycleLength: 30,
      avgPeriodDuration: 6,
    });

    await service.updateMe('user-id', {
      name: '  Ana   Maria ',
      phone: '+55 (81) 98888-7777',
      birthDate: '1995-03-10T18:00:00-03:00',
      cpf: '529.982.247-25',
      avgCycleLength: 30,
      avgPeriodDuration: 6,
    });

    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: {
        name: 'Ana Maria',
        phone: '81988887777',
        phoneVerifiedAt: null,
        birthDate: new Date('1995-03-10T00:00:00.000Z'),
        cpf: '52998224725',
        avgCycleLength: 30,
        avgPeriodDuration: 6,
      },
    });
  });

  it('keeps phone verification when formatting resolves to the same number', async () => {
    prisma.profile.update.mockResolvedValue(baseProfile);

    await service.updateMe('user-id', {
      phone: '+55 (81) 99999-0000',
    });

    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: {
        name: undefined,
        phone: '81999990000',
        phoneVerifiedAt: undefined,
        birthDate: undefined,
        cpf: undefined,
        avgCycleLength: undefined,
        avgPeriodDuration: undefined,
      },
    });
  });

  it('rejects CPF owned by another account', async () => {
    prisma.profile.findUnique.mockResolvedValue({ userId: 'other-user' });

    await expect(
      service.updateMe('user-id', {
        cpf: '529.982.247-25',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('rejects profile updates for missing users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.updateMe('missing-user', { name: 'Ana' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.profile.update).not.toHaveBeenCalled();
  });
});
