import { BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  type UserFindUniqueArgs = {
    where: { email: string };
  };
  type RegisteredUser = {
    id: string;
    email: string;
    emailVerifiedAt: Date | null;
    profile: { name: string | null; phoneVerifiedAt: Date | null } | null;
  };
  type UserCreateArgs = {
    data: {
      email: string;
      password: string;
      profile: {
        create: {
          name: string;
          phone?: string;
          birthDate?: Date | null;
          cpf?: string;
          avgCycleLength?: number;
          avgPeriodDuration?: number;
        };
      };
      cycleLogs?: {
        create: {
          startDate: Date;
          endDate: Date | null;
          duration: number | null;
        };
      };
    };
    include: { profile: true };
  };
  type UserDelegateMock = {
    findUnique: jest.Mock<Promise<{ id: string } | null>, [UserFindUniqueArgs]>;
    create: jest.Mock<Promise<RegisteredUser>, [UserCreateArgs]>;
  };

  const jwt = {
    sign: jest.fn().mockReturnValue('signed-token'),
  } as unknown as JwtService;
  let user: UserDelegateMock;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();

    user = {
      findUnique: jest.fn<
        Promise<{ id: string } | null>,
        [UserFindUniqueArgs]
      >(),
      create: jest.fn<Promise<RegisteredUser>, [UserCreateArgs]>(),
    };

    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);

    const prisma = { user } as unknown as PrismaService;
    service = new AuthService(prisma, jwt);
  });

  it('creates the initial cycle as complete when registration sends start and end dates', async () => {
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({
      id: 'user-id',
      email: 'ana@example.com',
      emailVerifiedAt: null,
      profile: { name: 'Ana', phoneVerifiedAt: null },
    });

    await service.register({
      email: 'ana@example.com',
      password: 'Password123',
      name: 'Ana',
      phone: '81999999999',
      birthDate: '1995-03-10',
      cpf: '12345678909',
      initialCycleData: {
        lastPeriodDate: '2026-05-10',
        lastPeriodEndDate: '2026-05-15',
        avgCycleLength: 28,
        avgPeriodDuration: 5,
      },
    });

    const createArgs = user.create.mock.calls[0]?.[0];

    if (!createArgs) {
      throw new Error('Expected user create call');
    }

    expect(createArgs).toEqual({
      data: {
        email: 'ana@example.com',
        password: 'hashed-password',
        profile: {
          create: {
            name: 'Ana',
            phone: '81999999999',
            birthDate: new Date('1995-03-10'),
            cpf: '12345678909',
            avgCycleLength: 28,
            avgPeriodDuration: 5,
          },
        },
        cycleLogs: {
          create: {
            startDate: new Date('2026-05-10'),
            endDate: new Date('2026-05-15'),
            duration: 5,
          },
        },
      },
      include: { profile: true },
    });
  });

  it('keeps the initial cycle incomplete when only the start date is available', async () => {
    user.findUnique.mockResolvedValue(null);
    user.create.mockResolvedValue({
      id: 'user-id',
      email: 'ana@example.com',
      emailVerifiedAt: null,
      profile: { name: 'Ana', phoneVerifiedAt: null },
    });

    await service.register({
      email: 'ana@example.com',
      password: 'Password123',
      name: 'Ana',
      initialCycleData: {
        lastPeriodDate: '2026-05-10',
        avgCycleLength: 28,
        avgPeriodDuration: 5,
      },
    });

    const createArgs = user.create.mock.calls[0]?.[0];

    if (!createArgs) {
      throw new Error('Expected user create call');
    }

    expect(createArgs.data.cycleLogs).toEqual({
      create: {
        startDate: new Date('2026-05-10'),
        endDate: null,
        duration: null,
      },
    });
  });

  it('rejects initial cycle data when the end date is before the start date', async () => {
    user.findUnique.mockResolvedValue(null);

    await expect(
      service.register({
        email: 'ana@example.com',
        password: 'Password123',
        name: 'Ana',
        initialCycleData: {
          lastPeriodDate: '2026-05-15',
          lastPeriodEndDate: '2026-05-10',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(user.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate email before hashing the password', async () => {
    user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.register({
        email: 'ana@example.com',
        password: 'Password123',
        name: 'Ana',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(user.create).not.toHaveBeenCalled();
  });
});
