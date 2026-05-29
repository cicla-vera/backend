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
  type AlertEvent,
  type EmergencyContact,
  type Profile,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingProviderService } from './messaging-provider.service';

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
  provider: string;
  providerMessageId?: string;
  reason?: string;
  message: string;
};

type DispatchCriticalAlertOptions = {
  source?: 'ai_escalation' | 'manual';
};

type DispatchLocation = {
  latitude: number;
  longitude: number;
};

type DispatchResponse = {
  alreadyDispatched: boolean;
  alertSessionId: string;
  level: AlertLevel;
  providerConfigured: boolean;
  attempts: DispatchAttempt[];
};

@Injectable()
export class EmergencyDispatchService {
  constructor(
    private prisma: PrismaService,
    private messagingProvider: MessagingProviderService,
  ) {}

  async dispatchCriticalAlert(
    userId: string,
    alertSessionId: string,
    options: DispatchCriticalAlertOptions = {},
  ): Promise<DispatchResponse> {
    const session = await this.findDispatchableSession(userId, alertSessionId);
    const contacts = await this.findActiveContacts(userId);
    const existingDispatchEvents = await this.findExistingDispatchEvents(
      userId,
      alertSessionId,
    );
    const notifiedContacts = this.getAlreadyNotifiedContacts(
      existingDispatchEvents,
    );

    if (contacts.length === 0) {
      const alreadyRecordedNoContactFailure =
        this.hasNoActiveContactsDispatchFailure(existingDispatchEvents);

      if (!alreadyRecordedNoContactFailure) {
        await this.prisma.alertEvent.create({
          data: {
            userId,
            alertSessionId,
            type: AlertEventType.CONTACT_NOTIFICATION_FAILED,
            message: 'No active emergency contacts configured.',
            metadata: {
              dispatchKind: 'critical_alert_contacts',
              dispatchSource: options.source ?? 'manual',
              reason: 'no_active_contacts',
            },
          },
        });
      }

      return {
        alreadyDispatched: alreadyRecordedNoContactFailure,
        alertSessionId,
        level: session.level,
        providerConfigured: false,
        attempts: [],
      };
    }

    const location = await this.findBestDispatchLocation(
      userId,
      alertSessionId,
      session,
    );
    const attempts = await Promise.all(
      contacts.map(async (contact) => {
        const previousNotification = notifiedContacts.get(contact.id);

        if (previousNotification) {
          return this.createAlreadyNotifiedAttempt(
            contact,
            previousNotification,
            session,
            location,
          );
        }

        return this.createDispatchAttempt({
          contact,
          location,
          session,
          source: options.source ?? 'manual',
          userId,
          alertSessionId,
        });
      }),
    );

    return {
      alreadyDispatched: attempts.every(
        (attempt) => attempt.reason === 'already_notified',
      ),
      alertSessionId,
      level: session.level,
      providerConfigured: attempts.some((attempt) => attempt.status === 'sent'),
      attempts,
    };
  }

  private async findExistingDispatchEvents(
    userId: string,
    alertSessionId: string,
  ): Promise<AlertEvent[]> {
    return this.prisma.alertEvent.findMany({
      where: {
        userId,
        alertSessionId,
        type: {
          in: [
            AlertEventType.CONTACT_NOTIFIED,
            AlertEventType.CONTACT_NOTIFICATION_FAILED,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async findBestDispatchLocation(
    userId: string,
    alertSessionId: string,
    session: AlertSession,
  ): Promise<DispatchLocation | null> {
    const latestLocationEvent = await this.prisma.alertEvent.findFirst({
      where: {
        userId,
        alertSessionId,
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      latestLocationEvent?.latitude !== null &&
      latestLocationEvent?.latitude !== undefined &&
      latestLocationEvent.longitude !== null &&
      latestLocationEvent.longitude !== undefined
    ) {
      return {
        latitude: latestLocationEvent.latitude,
        longitude: latestLocationEvent.longitude,
      };
    }

    if (session.initialLatitude === null || session.initialLongitude === null) {
      return null;
    }

    return {
      latitude: session.initialLatitude,
      longitude: session.initialLongitude,
    };
  }

  private getAlreadyNotifiedContacts(
    events: AlertEvent[],
  ): Map<string, AlertEvent> {
    const contacts = new Map<string, AlertEvent>();

    for (const event of events) {
      if (event.type !== AlertEventType.CONTACT_NOTIFIED) {
        continue;
      }

      const metadata = this.asMetadata(event.metadata);
      const contactId = this.getMetadataString(metadata, 'contactId');

      if (contactId) {
        contacts.set(contactId, event);
      }
    }

    return contacts;
  }

  private hasNoActiveContactsDispatchFailure(events: AlertEvent[]): boolean {
    return events.some((event) => {
      if (event.type !== AlertEventType.CONTACT_NOTIFICATION_FAILED) {
        return false;
      }

      const metadata = this.asMetadata(event.metadata);

      return (
        this.getMetadataString(metadata, 'reason') === 'no_active_contacts'
      );
    });
  }

  private createAlreadyNotifiedAttempt(
    contact: EmergencyContact,
    event: AlertEvent,
    session: AlertSessionWithProfile,
    location: DispatchLocation | null,
  ): DispatchAttempt {
    const metadata = this.asMetadata(event.metadata);

    return {
      contactId: contact.id,
      contactName: contact.name,
      priority: contact.priority,
      maskedPhone: this.maskPhone(contact.phone),
      status: 'sent',
      eventType: AlertEventType.CONTACT_NOTIFIED,
      provider: this.getMetadataString(metadata, 'provider') ?? 'previous',
      providerMessageId:
        this.getMetadataString(metadata, 'providerMessageId') ?? undefined,
      reason: 'already_notified',
      message:
        this.getMetadataString(metadata, 'message') ??
        this.buildEmergencyMessage(session, location),
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
    alertSessionId: string;
    contact: EmergencyContact;
    location: DispatchLocation | null;
    session: AlertSessionWithProfile;
    source: DispatchCriticalAlertOptions['source'];
    userId: string;
  }): Promise<DispatchAttempt> {
    const message = this.buildEmergencyMessage(input.session, input.location);
    const delivery = await this.messagingProvider.sendSms({
      to: input.contact.phone,
      body: message,
    });
    const status: DispatchStatus = delivery.status;
    const eventType =
      status === 'sent'
        ? AlertEventType.CONTACT_NOTIFIED
        : AlertEventType.CONTACT_NOTIFICATION_FAILED;
    const metadata: Record<string, string | number> = {
      contactId: input.contact.id,
      contactPriority: input.contact.priority,
      dispatchKind: 'critical_alert_contacts',
      dispatchSource: input.source ?? 'manual',
      deliveryChannel: 'sms',
      provider: delivery.provider,
      status,
      message,
    };

    if (delivery.providerMessageId) {
      metadata.providerMessageId = delivery.providerMessageId;
    }

    if (delivery.failureReason) {
      metadata.reason = delivery.failureReason;
    }

    await this.prisma.alertEvent.create({
      data: {
        userId: input.userId,
        alertSessionId: input.alertSessionId,
        type: eventType,
        message:
          status === 'sent'
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
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      reason: delivery.failureReason,
      message,
    };
  }

  private buildEmergencyMessage(
    session: AlertSessionWithProfile,
    location: DispatchLocation | null,
  ): string {
    const name = session.user.profile?.name?.trim() || 'Uma pessoa';
    const formattedLocation = this.formatApproximateLocation(location);
    const locationText = formattedLocation
      ? ` Local aproximado: ${formattedLocation}.`
      : ' Localizacao indisponivel.';

    return `Alerta Vera: ${name} pode estar em perigo agora.${locationText} Tente contato imediatamente e acione a policia ou emergencia local se nao conseguir confirmar que ela esta segura.`;
  }

  private formatApproximateLocation(
    location: DispatchLocation | null,
  ): string | null {
    if (!location) {
      return null;
    }

    return `${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}`;
  }

  private asMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private getMetadataString(
    metadata: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = metadata[key];

    return typeof value === 'string' ? value : null;
  }

  private maskPhone(phone: string): string {
    const visibleDigits = 4;
    const digits = phone.replace(/\D/g, '');

    if (digits.length <= visibleDigits) {
      return '*'.repeat(digits.length);
    }

    return `${'*'.repeat(digits.length - visibleDigits)}${digits.slice(-visibleDigits)}`;
  }
}
