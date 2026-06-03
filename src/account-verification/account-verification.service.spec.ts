import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AccountVerificationChannel,
  type AccountVerificationCode,
  type Profile,
  type User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AccountVerificationDeliveryService } from './account-verification-delivery.service';
import { AccountVerificationService } from './account-verification.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

type UserWithProfile = User & {
  profile: Profile | null;
};

type AccountVerificationCodeCreateArgs = {
  data: {
    userId: string;
    channel: AccountVerificationChannel;
    destination: string;
    codeHash: string;
    expiresAt: Date;
  };
};

type AccountVerificationCodeFindFirstArgs = {
  where: {
    userId: string;
    channel: AccountVerificationChannel;
    consumedAt: null;
    expiresAt: { gt: Date };
    attemptCount: { lt: number };
  };
  orderBy: { createdAt: 'desc' };
};

type AccountVerificationCodeUpdateArgs = {
  where: { id: string };
  data: {
    consumedAt?: Date;
    attemptCount?: { increment: number };
  };
};

type UserUpdateArgs = {
  where: { id: string };
  data: { emailVerifiedAt: Date };
  include: { profile: true };
};

type TransactionCallback = (tx: PrismaMock) => Promise<UserWithProfile>;

type PrismaMock = {
  user: {
    findUnique: jest.Mock<Promise<UserWithProfile | null>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<UserWithProfile>, [unknown]>;
    update: jest.Mock<Promise<UserWithProfile>, [UserUpdateArgs]>;
  };
  profile: {
    update: jest.Mock<Promise<Profile>, [unknown]>;
  };
  accountVerificationCode: {
    create: jest.Mock<
      Promise<AccountVerificationCode>,
      [AccountVerificationCodeCreateArgs]
    >;
    findFirst: jest.Mock<
      Promise<AccountVerificationCode | null>,
      [AccountVerificationCodeFindFirstArgs]
    >;
    update: jest.Mock<
      Promise<AccountVerificationCode>,
      [AccountVerificationCodeUpdateArgs]
    >;
  };
  $transaction: jest.Mock<Promise<UserWithProfile>, [TransactionCallback]>;
};

type DeliveryMock = {
  deliverVerificationCode: jest.Mock<
    ReturnType<AccountVerificationDeliveryService['deliverVerificationCode']>,
    Parameters<AccountVerificationDeliveryService['deliverVerificationCode']>
  >;
};

const baseProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'profile-id',
  userId: 'user-id',
  name: 'Ana',
  phone: '+5581999999999',
  phoneVerifiedAt: null,
  birthDate: null,
  cpf: null,
  avgCycleLength: null,
  avgPeriodDuration: null,
  createdAt: new Date('2026-06-03T12:00:00.000Z'),
  updatedAt: new Date('2026-06-03T12:00:00.000Z'),
  ...overrides,
});

const baseUser = (
  overrides: Partial<UserWithProfile> = {},
): UserWithProfile => ({
  id: 'user-id',
  email: 'ana@example.com',
  password: 'hashed-password',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-03T12:00:00.000Z'),
  updatedAt: new Date('2026-06-03T12:00:00.000Z'),
  profile: baseProfile(),
  ...overrides,
});

const baseCode = (
  overrides: Partial<AccountVerificationCode> = {},
): AccountVerificationCode => ({
  id: 'verification-code-id',
  userId: 'user-id',
  channel: AccountVerificationChannel.EMAIL,
  destination: 'ana@example.com',
  codeHash: 'hashed-code',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  consumedAt: null,
  attemptCount: 0,
  createdAt: new Date('2026-06-03T12:00:00.000Z'),
  updatedAt: new Date('2026-06-03T12:00:00.000Z'),
  ...overrides,
});

describe('AccountVerificationService', () => {
  let service: AccountVerificationService;
  let prisma: PrismaMock;
  let delivery: DeliveryMock;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findUnique: jest.fn<Promise<UserWithProfile | null>, [unknown]>(),
        findUniqueOrThrow: jest.fn<Promise<UserWithProfile>, [unknown]>(),
        update: jest.fn<Promise<UserWithProfile>, [UserUpdateArgs]>(),
      },
      profile: {
        update: jest.fn<Promise<Profile>, [unknown]>(),
      },
      accountVerificationCode: {
        create: jest.fn<
          Promise<AccountVerificationCode>,
          [AccountVerificationCodeCreateArgs]
        >(),
        findFirst: jest.fn<
          Promise<AccountVerificationCode | null>,
          [AccountVerificationCodeFindFirstArgs]
        >(),
        update: jest.fn<
          Promise<AccountVerificationCode>,
          [AccountVerificationCodeUpdateArgs]
        >(),
      },
      $transaction: jest.fn<Promise<UserWithProfile>, [TransactionCallback]>(),
    };
    delivery = {
      deliverVerificationCode: jest.fn<
        ReturnType<
          AccountVerificationDeliveryService['deliverVerificationCode']
        >,
        Parameters<
          AccountVerificationDeliveryService['deliverVerificationCode']
        >
      >(),
    };

    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-code' as never);
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);
    delivery.deliverVerificationCode.mockResolvedValue({
      provider: 'mock',
      devCode: '123456',
    });
    prisma.accountVerificationCode.create.mockResolvedValue(baseCode());

    service = new AccountVerificationService(
      prisma as unknown as PrismaService,
      delivery as unknown as AccountVerificationDeliveryService,
    );
  });

  it('returns masked verification status for the authenticated user', async () => {
    prisma.user.findUnique.mockResolvedValue(
      baseUser({
        emailVerifiedAt: new Date('2026-06-03T12:01:00.000Z'),
        profile: baseProfile({
          phoneVerifiedAt: new Date('2026-06-03T12:02:00.000Z'),
        }),
      }),
    );

    const result = await service.getStatus('user-id');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      include: { profile: true },
    });
    expect(result).toMatchObject({
      email: {
        value: 'ana@example.com',
        verified: true,
      },
      phone: {
        value: '*********9999',
        verified: true,
        available: true,
      },
    });
  });

  it('creates and delivers an email verification code through the mock provider', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser());

    const result = await service.requestEmailVerification('user-id');

    expect(bcrypt.hash).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{6}$/),
      10,
    );

    const createArgs = prisma.accountVerificationCode.create.mock.calls[0]?.[0];
    const deliveryArgs = delivery.deliverVerificationCode.mock.calls[0]?.[0];

    if (!createArgs || !deliveryArgs) {
      throw new Error('Expected verification code delivery calls');
    }

    expect(createArgs.data).toMatchObject({
      userId: 'user-id',
      channel: AccountVerificationChannel.EMAIL,
      destination: 'ana@example.com',
      codeHash: 'hashed-code',
    });
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date);
    expect(deliveryArgs).toMatchObject({
      channel: AccountVerificationChannel.EMAIL,
      destination: 'ana@example.com',
    });
    expect(deliveryArgs.code).toMatch(/^\d{6}$/);
    expect(deliveryArgs.expiresAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      channel: AccountVerificationChannel.EMAIL,
      destination: 'an**@example.com',
      provider: 'mock',
      devCode: '123456',
    });
  });

  it('rejects phone verification when the profile has no phone', async () => {
    prisma.user.findUnique.mockResolvedValue(
      baseUser({ profile: baseProfile({ phone: null }) }),
    );

    await expect(
      service.requestPhoneVerification('user-id'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.accountVerificationCode.create).not.toHaveBeenCalled();
  });

  it('confirms an email code and marks the user email as verified', async () => {
    const verifiedAt = new Date('2026-06-03T12:05:00.000Z');
    prisma.accountVerificationCode.findFirst.mockResolvedValue(baseCode());
    prisma.user.update.mockResolvedValue(
      baseUser({
        emailVerifiedAt: verifiedAt,
      }),
    );

    const result = await service.confirmEmailVerification('user-id', '123456');

    const findArgs =
      prisma.accountVerificationCode.findFirst.mock.calls[0]?.[0];

    if (!findArgs) {
      throw new Error('Expected verification code lookup');
    }

    expect(findArgs.where).toMatchObject({
      userId: 'user-id',
      channel: AccountVerificationChannel.EMAIL,
      consumedAt: null,
      attemptCount: { lt: 5 },
    });
    expect(findArgs.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(findArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(bcrypt.compare).toHaveBeenCalledWith('123456', 'hashed-code');

    const codeUpdateArgs =
      prisma.accountVerificationCode.update.mock.calls[0]?.[0];
    const userUpdateArgs = prisma.user.update.mock.calls[0]?.[0];

    if (!codeUpdateArgs || !userUpdateArgs) {
      throw new Error('Expected verification updates');
    }

    expect(codeUpdateArgs.where).toEqual({ id: 'verification-code-id' });
    expect(codeUpdateArgs.data.consumedAt).toBeInstanceOf(Date);
    expect(userUpdateArgs.where).toEqual({ id: 'user-id' });
    expect(userUpdateArgs.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(userUpdateArgs.include).toEqual({ profile: true });
    expect(result.channel).toBe(AccountVerificationChannel.EMAIL);
    expect(result.email.verified).toBe(true);
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it('increments attempts and rejects invalid codes without leaking details', async () => {
    prisma.accountVerificationCode.findFirst.mockResolvedValue(
      baseCode({ attemptCount: 4 }),
    );
    jest.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(
      service.confirmEmailVerification('user-id', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const updateArgs = prisma.accountVerificationCode.update.mock.calls[0]?.[0];

    if (!updateArgs) {
      throw new Error('Expected attempt update');
    }

    expect(updateArgs.where).toEqual({ id: 'verification-code-id' });
    expect(updateArgs.data.attemptCount).toEqual({ increment: 1 });
    expect(updateArgs.data.consumedAt).toBeInstanceOf(Date);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects verification when the authenticated user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getStatus('missing-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
