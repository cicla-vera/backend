import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountVerificationChannel,
  type AccountVerificationCode,
  type Profile,
  type User,
} from '@prisma/client';
import { randomInt } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AccountVerificationDeliveryService } from './account-verification-delivery.service';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_HASH_ROUNDS = 10;
const MAX_CONFIRM_ATTEMPTS = 5;

type UserWithProfile = User & {
  profile: Profile | null;
};

type VerificationStatusResponse = {
  email: {
    value: string;
    verifiedAt: Date | null;
    verified: boolean;
  };
  phone: {
    value: string | null;
    verifiedAt: Date | null;
    verified: boolean;
    available: boolean;
  };
};

type VerificationRequestResponse = {
  channel: AccountVerificationChannel;
  destination: string;
  expiresAt: Date;
  provider: string;
  devCode?: string;
};

type VerificationConfirmResponse = VerificationStatusResponse & {
  channel: AccountVerificationChannel;
  verifiedAt: Date;
};

@Injectable()
export class AccountVerificationService {
  constructor(
    private prisma: PrismaService,
    private delivery: AccountVerificationDeliveryService,
  ) {}

  async getStatus(userId: string): Promise<VerificationStatusResponse> {
    const user = await this.findUser(userId);

    return this.toStatusResponse(user);
  }

  async requestEmailVerification(
    userId: string,
  ): Promise<VerificationRequestResponse> {
    const user = await this.findUser(userId);

    return this.createAndDeliverCode({
      userId,
      channel: AccountVerificationChannel.EMAIL,
      destination: user.email,
    });
  }

  async requestPhoneVerification(
    userId: string,
  ): Promise<VerificationRequestResponse> {
    const user = await this.findUser(userId);
    const phone = user.profile?.phone?.trim();

    if (!phone) {
      throw new BadRequestException('Phone number is required.');
    }

    return this.createAndDeliverCode({
      userId,
      channel: AccountVerificationChannel.PHONE,
      destination: phone,
    });
  }

  async confirmEmailVerification(
    userId: string,
    code: string,
  ): Promise<VerificationConfirmResponse> {
    return this.confirmCode(userId, AccountVerificationChannel.EMAIL, code);
  }

  async confirmPhoneVerification(
    userId: string,
    code: string,
  ): Promise<VerificationConfirmResponse> {
    return this.confirmCode(userId, AccountVerificationChannel.PHONE, code);
  }

  private async createAndDeliverCode(input: {
    userId: string;
    channel: AccountVerificationChannel;
    destination: string;
  }): Promise<VerificationRequestResponse> {
    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, CODE_HASH_ROUNDS);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await this.prisma.accountVerificationCode.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        destination: input.destination,
        codeHash,
        expiresAt,
      },
    });

    const delivery = await this.delivery.deliverVerificationCode({
      channel: input.channel,
      destination: input.destination,
      code,
      expiresAt,
    });

    return {
      channel: input.channel,
      destination: this.maskDestination(input.channel, input.destination),
      expiresAt,
      provider: delivery.provider,
      ...(delivery.devCode ? { devCode: delivery.devCode } : {}),
    };
  }

  private async confirmCode(
    userId: string,
    channel: AccountVerificationChannel,
    code: string,
  ): Promise<VerificationConfirmResponse> {
    const verificationCode = await this.findLatestActiveCode(userId, channel);

    if (!verificationCode) {
      throw this.invalidCodeException();
    }

    const matches = await bcrypt.compare(code, verificationCode.codeHash);

    if (!matches) {
      await this.registerFailedAttempt(verificationCode);
      throw this.invalidCodeException();
    }

    const verifiedAt = new Date();

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      await tx.accountVerificationCode.update({
        where: { id: verificationCode.id },
        data: { consumedAt: verifiedAt },
      });

      if (channel === AccountVerificationChannel.EMAIL) {
        return tx.user.update({
          where: { id: userId },
          data: { emailVerifiedAt: verifiedAt },
          include: { profile: true },
        });
      }

      await tx.profile.update({
        where: { userId },
        data: { phoneVerifiedAt: verifiedAt },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { profile: true },
      });
    });

    return {
      ...this.toStatusResponse(updatedUser),
      channel,
      verifiedAt,
    };
  }

  private async findUser(userId: string): Promise<UserWithProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async findLatestActiveCode(
    userId: string,
    channel: AccountVerificationChannel,
  ): Promise<AccountVerificationCode | null> {
    return this.prisma.accountVerificationCode.findFirst({
      where: {
        userId,
        channel,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attemptCount: { lt: MAX_CONFIRM_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async registerFailedAttempt(
    verificationCode: AccountVerificationCode,
  ) {
    const nextAttemptCount = verificationCode.attemptCount + 1;

    await this.prisma.accountVerificationCode.update({
      where: { id: verificationCode.id },
      data: {
        attemptCount: { increment: 1 },
        ...(nextAttemptCount >= MAX_CONFIRM_ATTEMPTS
          ? { consumedAt: new Date() }
          : {}),
      },
    });
  }

  private toStatusResponse(user: UserWithProfile): VerificationStatusResponse {
    const phone = user.profile?.phone ?? null;
    const phoneVerifiedAt = phone
      ? (user.profile?.phoneVerifiedAt ?? null)
      : null;

    return {
      email: {
        value: user.email,
        verifiedAt: user.emailVerifiedAt,
        verified: Boolean(user.emailVerifiedAt),
      },
      phone: {
        value: phone
          ? this.maskDestination(AccountVerificationChannel.PHONE, phone)
          : null,
        verifiedAt: phoneVerifiedAt,
        verified: Boolean(phoneVerifiedAt),
        available: Boolean(phone),
      },
    };
  }

  private maskDestination(
    channel: AccountVerificationChannel,
    destination: string,
  ) {
    if (channel === AccountVerificationChannel.EMAIL) {
      const [localPart = '', domain = ''] = destination.split('@');
      const visible = localPart.slice(0, 2);

      return `${visible}${'*'.repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
    }

    const digits = destination.replace(/\D/g, '');

    if (digits.length <= 4) {
      return '*'.repeat(digits.length);
    }

    return `${'*'.repeat(Math.max(digits.length - 4, 2))}${digits.slice(-4)}`;
  }

  private generateCode() {
    return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  }

  private invalidCodeException() {
    return new BadRequestException('Verification code is invalid or expired.');
  }
}
