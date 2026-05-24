import { BadRequestException, Injectable } from '@nestjs/common';
import type { SafetyProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSafetyProfileDto } from './dto/update-safety-profile.dto';

type SafetyProfileUpdateData = {
  veraEnabled?: boolean;
  consentAccepted?: boolean;
  consentAcceptedAt?: Date | null;
  biometricUnlockEnabled?: boolean;
  discreetNotificationsEnabled?: boolean;
  monitoringEnabled?: boolean;
};

export type SafetyProfileResponse = {
  id: string;
  userId: string;
  veraEnabled: boolean;
  consentAccepted: boolean;
  consentAcceptedAt: Date | null;
  pinConfigured: boolean;
  pinUpdatedAt: Date | null;
  biometricUnlockEnabled: boolean;
  discreetNotificationsEnabled: boolean;
  monitoringEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class VeraService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const profile = await this.getOrCreateProfile(userId);
    return this.toResponse(profile);
  }

  async saveProfile(userId: string, dto: UpdateSafetyProfileDto) {
    const profile = await this.getOrCreateProfile(userId);
    const data = this.buildUpdateData(profile, dto);

    if (Object.keys(data).length === 0) {
      return this.toResponse(profile);
    }

    const updated = await this.prisma.safetyProfile.update({
      where: { userId },
      data,
    });

    return this.toResponse(updated);
  }

  private async getOrCreateProfile(userId: string) {
    return this.prisma.safetyProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  private buildUpdateData(
    profile: SafetyProfile,
    dto: UpdateSafetyProfileDto,
  ): SafetyProfileUpdateData {
    const acceptingConsent = dto.consentAccepted === true;
    const revokingConsent = dto.consentAccepted === false;
    const effectiveConsent = acceptingConsent
      ? true
      : revokingConsent
        ? false
        : profile.consentAccepted;

    if (
      !effectiveConsent &&
      (dto.veraEnabled === true || dto.monitoringEnabled === true)
    ) {
      throw new BadRequestException(
        'Consent must be accepted before enabling Vera mode.',
      );
    }

    const data: SafetyProfileUpdateData = {};

    if (dto.consentAccepted !== undefined) {
      data.consentAccepted = dto.consentAccepted;
      data.consentAcceptedAt = dto.consentAccepted
        ? (profile.consentAcceptedAt ?? new Date())
        : null;
    }

    if (dto.veraEnabled !== undefined) {
      data.veraEnabled = dto.veraEnabled;
    }

    if (dto.biometricUnlockEnabled !== undefined) {
      data.biometricUnlockEnabled = dto.biometricUnlockEnabled;
    }

    if (dto.discreetNotificationsEnabled !== undefined) {
      data.discreetNotificationsEnabled = dto.discreetNotificationsEnabled;
    }

    if (dto.monitoringEnabled !== undefined) {
      data.monitoringEnabled = dto.monitoringEnabled;
    }

    if (revokingConsent) {
      data.veraEnabled = false;
      data.monitoringEnabled = false;
    }

    if (data.veraEnabled === false) {
      data.monitoringEnabled = false;
    }

    if (data.monitoringEnabled === true) {
      data.veraEnabled = true;
    }

    return data;
  }

  private toResponse(profile: SafetyProfile): SafetyProfileResponse {
    return {
      id: profile.id,
      userId: profile.userId,
      veraEnabled: profile.veraEnabled,
      consentAccepted: profile.consentAccepted,
      consentAcceptedAt: profile.consentAcceptedAt,
      pinConfigured: profile.pinHash !== null,
      pinUpdatedAt: profile.pinUpdatedAt,
      biometricUnlockEnabled: profile.biometricUnlockEnabled,
      discreetNotificationsEnabled: profile.discreetNotificationsEnabled,
      monitoringEnabled: profile.monitoringEnabled,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
