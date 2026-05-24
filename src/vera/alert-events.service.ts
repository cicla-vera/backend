import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  type AlertEvent,
  type AlertSession,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertEventDto } from './dto/create-alert-event.dto';

type MetadataValue = string | number | boolean | null;
type MetadataPayload = Record<string, MetadataValue>;

type AlertSessionWithEvents = AlertSession & {
  events: AlertEvent[];
};

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_LENGTH = 40;
const MAX_METADATA_STRING_LENGTH = 240;

@Injectable()
export class AlertEventsService {
  constructor(private prisma: PrismaService) {}

  async findTimeline(userId: string, alertSessionId: string) {
    const session = await this.findSessionWithEvents(userId, alertSessionId);

    return {
      alertSessionId: session.id,
      status: session.status,
      level: session.level,
      events: session.events,
    };
  }

  async create(
    userId: string,
    alertSessionId: string,
    dto: CreateAlertEventDto,
  ) {
    this.validateCoordinatePair(dto.latitude, dto.longitude);

    const session = await this.findSession(userId, alertSessionId);

    if (session.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException(
        'Events can only be registered on active alert sessions.',
      );
    }

    const metadata = this.sanitizeMetadata(dto.metadata);

    if (dto.type === AlertEventType.ALERT_ESCALATED) {
      await this.prisma.alertSession.update({
        where: { id: alertSessionId },
        data: {
          level: AlertLevel.CRITICAL,
          criticalEscalatedAt: session.criticalEscalatedAt ?? new Date(),
        },
      });
    }

    return this.prisma.alertEvent.create({
      data: {
        userId,
        alertSessionId,
        type: dto.type,
        message: dto.message,
        metadata,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  private async findSessionWithEvents(
    userId: string,
    alertSessionId: string,
  ): Promise<AlertSessionWithEvents> {
    const session = await this.prisma.alertSession.findFirst({
      where: { id: alertSessionId, userId },
      include: {
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Alert session not found');
    }

    return session;
  }

  private async findSession(
    userId: string,
    alertSessionId: string,
  ): Promise<AlertSession> {
    const session = await this.prisma.alertSession.findFirst({
      where: { id: alertSessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Alert session not found');
    }

    return session;
  }

  private validateCoordinatePair(latitude?: number, longitude?: number): void {
    const hasLatitude = latitude !== undefined;
    const hasLongitude = longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'Latitude and longitude must be sent together.',
      );
    }
  }

  private sanitizeMetadata(
    metadata?: Record<string, MetadataValue>,
  ): MetadataPayload | undefined {
    if (!metadata) {
      return undefined;
    }

    const entries = Object.entries(metadata);

    if (entries.length > MAX_METADATA_KEYS) {
      throw new BadRequestException('Metadata has too many keys.');
    }

    const sanitized: MetadataPayload = {};

    for (const [key, value] of entries) {
      if (key.length === 0 || key.length > MAX_METADATA_KEY_LENGTH) {
        throw new BadRequestException('Metadata contains an invalid key.');
      }

      if (typeof value === 'string') {
        if (value.length > MAX_METADATA_STRING_LENGTH) {
          throw new BadRequestException('Metadata string value is too long.');
        }

        sanitized[key] = value;
        continue;
      }

      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          throw new BadRequestException('Metadata contains an invalid number.');
        }

        sanitized[key] = value;
        continue;
      }

      if (typeof value === 'boolean' || value === null) {
        sanitized[key] = value;
        continue;
      }

      throw new BadRequestException(
        'Metadata only accepts string, number, boolean, or null values.',
      );
    }

    return sanitized;
  }
}
