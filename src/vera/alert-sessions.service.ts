import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  type AlertEvent,
  type AlertSession,
  type SafetyLocation,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloseAlertSessionDto } from './dto/close-alert-session.dto';
import { StartLocationAlertSessionDto } from './dto/start-location-alert-session.dto';
import { StartManualAlertSessionDto } from './dto/start-manual-alert-session.dto';

type AlertSessionWithEvents = AlertSession & {
  events: AlertEvent[];
};

type AlertSessionResponse = AlertSessionWithEvents & {
  alreadyActive: boolean;
};

const DEFAULT_RECENT_SESSIONS_LIMIT = 12;
const MAX_RECENT_SESSIONS_LIMIT = 50;

@Injectable()
export class AlertSessionsService {
  constructor(private prisma: PrismaService) {}

  async findRecent(
    userId: string,
    limit?: string,
  ): Promise<AlertSessionResponse[]> {
    const take = this.parseRecentLimit(limit);
    const sessions = await this.prisma.alertSession.findMany({
      where: { userId },
      include: this.withOrderedEvents(),
      orderBy: { startedAt: 'desc' },
      take,
    });

    return sessions.map((session) =>
      this.toResponse(session, session.status === AlertStatus.ACTIVE),
    );
  }

  async startManual(
    userId: string,
    dto: StartManualAlertSessionDto,
  ): Promise<AlertSessionResponse> {
    this.validateCoordinatePair(dto.initialLatitude, dto.initialLongitude);

    const activeSession = await this.findActiveRaw(userId);

    if (activeSession) {
      return this.toResponse(activeSession, true);
    }

    const session = await this.prisma.alertSession.create({
      data: {
        userId,
        trigger: AlertTrigger.MANUAL,
        level: AlertLevel.NORMAL,
        initialLatitude: dto.initialLatitude,
        initialLongitude: dto.initialLongitude,
        events: {
          create: {
            userId,
            type: AlertEventType.SESSION_STARTED,
            message: dto.message,
            metadata: { source: 'manual' },
            latitude: dto.initialLatitude,
            longitude: dto.initialLongitude,
          },
        },
      },
      include: this.withOrderedEvents(),
    });

    return this.toResponse(session, false);
  }

  async startLocation(
    userId: string,
    dto: StartLocationAlertSessionDto,
  ): Promise<AlertSessionResponse> {
    const safetyLocation = await this.findActiveSafetyLocation(
      userId,
      dto.safetyLocationId,
    );
    const activeSession = await this.findActiveRaw(userId);

    if (activeSession) {
      return this.toResponse(activeSession, true);
    }

    const session = await this.prisma.alertSession.create({
      data: {
        userId,
        safetyLocationId: safetyLocation.id,
        trigger: AlertTrigger.LOCATION,
        level: AlertLevel.NORMAL,
        initialLatitude: dto.currentLatitude,
        initialLongitude: dto.currentLongitude,
        events: {
          create: [
            {
              userId,
              type: AlertEventType.SESSION_STARTED,
              message: dto.message,
              metadata: {
                source: 'location',
                safetyLocationId: safetyLocation.id,
              },
              latitude: dto.currentLatitude,
              longitude: dto.currentLongitude,
            },
            {
              userId,
              type: AlertEventType.LOCATION_ENTERED,
              message: dto.message,
              metadata: {
                safetyLocationId: safetyLocation.id,
                safetyLocationName: safetyLocation.name,
                safetyLocationType: safetyLocation.type,
                radiusMeters: safetyLocation.radiusMeters,
              },
              latitude: dto.currentLatitude,
              longitude: dto.currentLongitude,
            },
          ],
        },
      },
      include: this.withOrderedEvents(),
    });

    return this.toResponse(session, false);
  }

  async findActive(userId: string): Promise<AlertSessionResponse | null> {
    const session = await this.findActiveRaw(userId);
    return session ? this.toResponse(session, true) : null;
  }

  async findOne(userId: string, id: string): Promise<AlertSessionResponse> {
    const session = await this.findOneRaw(userId, id);
    return this.toResponse(session, session.status === AlertStatus.ACTIVE);
  }

  async close(
    userId: string,
    id: string,
    dto: CloseAlertSessionDto,
  ): Promise<AlertSessionResponse> {
    if (dto.status === AlertStatus.ACTIVE) {
      throw new BadRequestException(
        'Alert session can only be closed as resolved or cancelled.',
      );
    }

    const session = await this.findOneRaw(userId, id);

    if (session.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException('Alert session is already closed.');
    }

    const updated = await this.prisma.alertSession.update({
      where: { id },
      data: {
        status: dto.status,
        endedAt: new Date(),
        events: {
          create: {
            userId,
            type: AlertEventType.SESSION_CLOSED,
            message: dto.message,
            metadata: { status: dto.status },
          },
        },
      },
      include: this.withOrderedEvents(),
    });

    return this.toResponse(updated, false);
  }

  private async findActiveRaw(
    userId: string,
  ): Promise<AlertSessionWithEvents | null> {
    return this.prisma.alertSession.findFirst({
      where: {
        userId,
        status: AlertStatus.ACTIVE,
      },
      include: this.withOrderedEvents(),
      orderBy: { startedAt: 'desc' },
    });
  }

  private async findOneRaw(
    userId: string,
    id: string,
  ): Promise<AlertSessionWithEvents> {
    const session = await this.prisma.alertSession.findFirst({
      where: { id, userId },
      include: this.withOrderedEvents(),
    });

    if (!session) {
      throw new NotFoundException('Alert session not found');
    }

    return session;
  }

  private async findActiveSafetyLocation(
    userId: string,
    id: string,
  ): Promise<SafetyLocation> {
    const safetyLocation = await this.prisma.safetyLocation.findFirst({
      where: {
        id,
        userId,
        enabled: true,
      },
    });

    if (!safetyLocation) {
      throw new NotFoundException('Active safety location not found');
    }

    return safetyLocation;
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

  private parseRecentLimit(limit?: string): number {
    if (!limit) {
      return DEFAULT_RECENT_SESSIONS_LIMIT;
    }

    const parsed = Number.parseInt(limit, 10);

    if (!Number.isFinite(parsed)) {
      return DEFAULT_RECENT_SESSIONS_LIMIT;
    }

    return Math.min(Math.max(parsed, 1), MAX_RECENT_SESSIONS_LIMIT);
  }

  private withOrderedEvents() {
    return {
      events: {
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }

  private toResponse(
    session: AlertSessionWithEvents,
    alreadyActive: boolean,
  ): AlertSessionResponse {
    return {
      ...session,
      alreadyActive,
    };
  }
}
