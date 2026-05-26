import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SafetyProfile } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SetVeraPinDto } from './dto/set-vera-pin.dto';
import { VerifyVeraPinDto } from './dto/verify-vera-pin.dto';

const HASH_ROUNDS = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const VERA_SESSION_TTL_SECONDS = 10 * 60;

type PinAttemptState = {
  failedAttempts: number;
  lockedUntil?: Date;
};

type PinStatusResponse = {
  pinConfigured: boolean;
  pinUpdatedAt: Date | null;
};

type VeraPinVerificationResponse = PinStatusResponse & {
  verified: true;
  veraSessionToken: string;
  expiresAt: Date;
};

@Injectable()
export class VeraPinService {
  private readonly pinAttempts = new Map<string, PinAttemptState>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async setPin(userId: string, dto: SetVeraPinDto): Promise<PinStatusResponse> {
    const profile = await this.getOrCreateProfile(userId);

    if (profile.pinHash) {
      if (!dto.currentPin) {
        throw new BadRequestException('Current Vera PIN is required.');
      }

      await this.assertPinMatches(userId, dto.currentPin, profile.pinHash);
    }

    const pinHash = await bcrypt.hash(dto.pin, HASH_ROUNDS);
    const updated = await this.prisma.safetyProfile.update({
      where: { userId },
      data: {
        pinHash,
        pinUpdatedAt: new Date(),
      },
    });

    this.clearAttempts(userId);

    return {
      pinConfigured: true,
      pinUpdatedAt: updated.pinUpdatedAt,
    };
  }

  async verifyPin(
    userId: string,
    dto: VerifyVeraPinDto,
  ): Promise<VeraPinVerificationResponse> {
    const profile = await this.getOrCreateProfile(userId);

    if (!profile.pinHash) {
      throw new BadRequestException('Vera PIN is not configured.');
    }

    await this.assertPinMatches(userId, dto.pin, profile.pinHash);

    const expiresAt = new Date(Date.now() + VERA_SESSION_TTL_SECONDS * 1000);
    const veraSessionToken = this.jwt.sign(
      {
        sub: userId,
        scope: 'vera',
        kind: 'vera-session',
      },
      { expiresIn: VERA_SESSION_TTL_SECONDS },
    );

    return {
      verified: true,
      veraSessionToken,
      expiresAt,
      pinConfigured: true,
      pinUpdatedAt: profile.pinUpdatedAt,
    };
  }

  private async getOrCreateProfile(userId: string): Promise<SafetyProfile> {
    return this.prisma.safetyProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  private async assertPinMatches(
    userId: string,
    pin: string,
    pinHash: string,
  ): Promise<void> {
    this.assertNotLocked(userId);

    const pinMatches = await bcrypt.compare(pin, pinHash);

    if (!pinMatches) {
      this.registerFailedAttempt(userId);
      throw new UnauthorizedException('Invalid Vera PIN.');
    }

    this.clearAttempts(userId);
  }

  private assertNotLocked(userId: string): void {
    const attemptState = this.pinAttempts.get(userId);

    if (
      attemptState?.lockedUntil &&
      attemptState.lockedUntil.getTime() > Date.now()
    ) {
      throw new HttpException(
        'Too many failed Vera PIN attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      attemptState?.lockedUntil &&
      attemptState.lockedUntil.getTime() <= Date.now()
    ) {
      this.pinAttempts.delete(userId);
    }
  }

  private registerFailedAttempt(userId: string): void {
    const currentState = this.pinAttempts.get(userId);
    const failedAttempts = (currentState?.failedAttempts ?? 0) + 1;

    this.pinAttempts.set(userId, {
      failedAttempts,
      lockedUntil:
        failedAttempts >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCK_DURATION_MS)
          : undefined,
    });
  }

  private clearAttempts(userId: string): void {
    this.pinAttempts.delete(userId);
  }
}
