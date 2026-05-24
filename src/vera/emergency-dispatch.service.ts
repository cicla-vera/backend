import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  type AlertSession,
  type EmergencyContact,
  type Profile,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AlertSessionWithProfile = AlertSession & {
  user: {
    profile: Profile | null;
  };
};

type DispatchStatus = 'sent' | 'failed';

type DispatchAttempt = {
  contactId: string;
  contactName: string;
  priority: number;
  maskedPhone: string;
  status: DispatchStatus;
  eventType: AlertEventType;
  reason?: string;
  message: string;
};

type DispatchResponse = {
  alertSessionId: string;
  level: AlertLevel;
  providerConfigured: boolean;
  attempts: DispatchAttempt[];
};

const MOCK_DISPATCH_MODE = 'mock';

@Injectable()
export class EmergencyDispatchService {
  constructor(private prisma: PrismaService) {}

  async dispatchCriticalAlert(
    userId: string,
    alertSessionId: string,
  ): Promise<DispatchResponse> {
    const session = await this.findDispatchableSession(userId, alertSessionId);
    const contacts = await this.findActiveContacts(userId);
    const providerConfigured = this.isProviderConfigured();

    if (contacts.length === 0) {
      await this.prisma.alertEvent.create({
        data: {
          userId,
          alertSessionId,
          type: AlertEventType.CONTACT_NOTIFICATION_FAILED,
          message: 'No active emergency contacts configured.',
          metadata: { reason: 'no_active_contacts' },
        },
      });

      return {
        alertSessionId,
        level: session.level,
        providerConfigured,
        attempts: [],
      };
    }

    const attempts = await Promise.all(
      contacts.map((contact) =>
        this.createDispatchAttempt({
          contact,
          providerConfigured,
          session,
          userId,
          alertSessionId,
        }),
      ),
    );

    return {
      alertSessionId,
      level: session.level,
      providerConfigured,
      attempts,
    };
  }

  private async findDispatchableSession(
    userId: string,
    alertSessionId: string,
  ): Promise<AlertSessionWithProfile> {
    const session = await this.prisma.alertSession.findFirst({
      where: { id: alertSessionId, userId },
      include: {
        user: {
          select: {
            profile: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Alert session not found');
    }

    if (session.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException(
        'Emergency contacts can only be notified for active alert sessions.',
      );
    }

    if (session.level !== AlertLevel.CRITICAL) {
      throw new BadRequestException(
        'Emergency contacts can only be notified for critical alerts.',
      );
    }

    return session;
  }

  private async findActiveContacts(
    userId: string,
  ): Promise<EmergencyContact[]> {
    return this.prisma.emergencyContact.findMany({
      where: { userId, enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async createDispatchAttempt(input: {
    contact: EmergencyContact;
    providerConfigured: boolean;
    session: AlertSessionWithProfile;
    userId: string;
    alertSessionId: string;
  }): Promise<DispatchAttempt> {
    const message = this.buildEmergencyMessage(input.session);
    const status: DispatchStatus = input.providerConfigured ? 'sent' : 'failed';
    const eventType = input.providerConfigured
      ? AlertEventType.CONTACT_NOTIFIED
      : AlertEventType.CONTACT_NOTIFICATION_FAILED;
    const reason = input.providerConfigured
      ? undefined
      : 'delivery_provider_not_configured';
    const metadata: Record<string, string | number> = {
      contactId: input.contact.id,
      contactPriority: input.contact.priority,
      deliveryChannel: 'sms',
      provider: this.getDispatchMode(),
      status,
      message,
    };

    if (reason) {
      metadata.reason = reason;
    }

    await this.prisma.alertEvent.create({
      data: {
        userId: input.userId,
        alertSessionId: input.alertSessionId,
        type: eventType,
        message: input.providerConfigured
          ? 'Emergency contact notification prepared.'
          : 'Emergency contact notification could not be sent.',
        metadata,
      },
    });

    return {
      contactId: input.contact.id,
      contactName: input.contact.name,
      priority: input.contact.priority,
      maskedPhone: this.maskPhone(input.contact.phone),
      status,
      eventType,
      reason,
      message,
    };
  }

  private buildEmergencyMessage(session: AlertSessionWithProfile): string {
    const name = session.user.profile?.name?.trim() || 'A Vera user';
    const location = this.formatApproximateLocation(
      session.initialLatitude,
      session.initialLongitude,
    );
    const locationText = location
      ? ` Approximate location: ${location}.`
      : ' Location is not available.';

    return `${name} may be in danger and needs help.${locationText} Please try to contact her and call local emergency services if needed.`;
  }

  private formatApproximateLocation(
    latitude: number | null,
    longitude: number | null,
  ): string | null {
    if (latitude === null || longitude === null) {
      return null;
    }

    return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  }

  private maskPhone(phone: string): string {
    const visibleDigits = 4;
    const digits = phone.replace(/\D/g, '');

    if (digits.length <= visibleDigits) {
      return '*'.repeat(digits.length);
    }

    return `${'*'.repeat(digits.length - visibleDigits)}${digits.slice(-visibleDigits)}`;
  }

  private isProviderConfigured(): boolean {
    return this.getDispatchMode() === MOCK_DISPATCH_MODE;
  }

  private getDispatchMode(): string {
    return process.env.EMERGENCY_CONTACT_DISPATCH_MODE ?? 'not_configured';
  }
}
