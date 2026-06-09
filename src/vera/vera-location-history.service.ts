import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LocationSampleSource, type VeraLocationSample } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RecordVeraLocationHistoryDto,
  VeraLocationHistorySampleDto,
} from './dto/record-vera-location-history.dto';

type NormalizedVeraLocationSample = {
  accuracyMeters?: number;
  address?: string;
  alertSessionId?: string;
  altitudeMeters?: number;
  capturedAt: Date;
  formattedAddress?: string;
  headingDegrees?: number;
  latitude: number;
  longitude: number;
  monitoringState?: string;
  placeId?: string;
  safetyLocationId?: string;
  source: LocationSampleSource;
  speedMetersPerSecond?: number;
};

const MAX_LOCATION_SAMPLES_PER_REQUEST = 50;
const MAX_LOCATION_SAMPLE_FUTURE_MS = 5 * 60 * 1000;

@Injectable()
export class VeraLocationHistoryService {
  constructor(private prisma: PrismaService) {}

  async record(userId: string, dto: RecordVeraLocationHistoryDto) {
    const samples = this.normalizeSamples(dto);
    await this.assertOwnedReferences(userId, samples);

    const created = await this.prisma.$transaction(
      samples.map((sample) =>
        this.prisma.veraLocationSample.create({
          data: {
            userId,
            alertSessionId: sample.alertSessionId,
            safetyLocationId: sample.safetyLocationId,
            latitude: sample.latitude,
            longitude: sample.longitude,
            accuracyMeters: sample.accuracyMeters,
            altitudeMeters: sample.altitudeMeters,
            speedMetersPerSecond: sample.speedMetersPerSecond,
            headingDegrees: sample.headingDegrees,
            source: sample.source,
            monitoringState: sample.monitoringState,
            address: sample.address,
            formattedAddress: sample.formattedAddress,
            placeId: sample.placeId,
            capturedAt: sample.capturedAt,
          },
        }),
      ),
    );

    return {
      samples: created.map((sample) => this.toResponse(sample)),
    };
  }

  async findAll(userId: string, limitValue?: string) {
    const limit = this.parseLimit(limitValue);
    const samples = await this.prisma.veraLocationSample.findMany({
      where: { userId },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return samples.reverse().map((sample) => this.toResponse(sample));
  }

  private normalizeSamples(
    dto: RecordVeraLocationHistoryDto,
  ): NormalizedVeraLocationSample[] {
    const payloadSamples = dto.samples?.length
      ? dto.samples
      : this.getSingleSamplePayload(dto);

    if (payloadSamples.length === 0) {
      throw new BadRequestException(
        'At least one location sample is required.',
      );
    }

    if (payloadSamples.length > MAX_LOCATION_SAMPLES_PER_REQUEST) {
      throw new BadRequestException('Too many location samples.');
    }

    return payloadSamples.map((sample) => this.normalizeSample(sample));
  }

  private getSingleSamplePayload(
    dto: RecordVeraLocationHistoryDto,
  ): VeraLocationHistorySampleDto[] {
    if (
      dto.latitude === undefined ||
      dto.longitude === undefined ||
      !dto.capturedAt
    ) {
      return [];
    }

    return [
      {
        accuracyMeters: dto.accuracyMeters,
        address: dto.address,
        alertSessionId: dto.alertSessionId,
        altitudeMeters: dto.altitudeMeters,
        capturedAt: dto.capturedAt,
        formattedAddress: dto.formattedAddress,
        headingDegrees: dto.headingDegrees,
        latitude: dto.latitude,
        longitude: dto.longitude,
        monitoringState: dto.monitoringState,
        placeId: dto.placeId,
        safetyLocationId: dto.safetyLocationId,
        source: dto.source,
        speedMetersPerSecond: dto.speedMetersPerSecond,
      },
    ];
  }

  private normalizeSample(
    sample: VeraLocationHistorySampleDto,
  ): NormalizedVeraLocationSample {
    const capturedAt = new Date(sample.capturedAt);

    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('Invalid location sample timestamp.');
    }

    if (capturedAt.getTime() > Date.now() + MAX_LOCATION_SAMPLE_FUTURE_MS) {
      throw new BadRequestException(
        'Location sample timestamp is too far ahead.',
      );
    }

    return {
      accuracyMeters: sample.accuracyMeters,
      address: sample.address,
      alertSessionId: sample.alertSessionId,
      altitudeMeters: sample.altitudeMeters,
      capturedAt,
      formattedAddress: sample.formattedAddress,
      headingDegrees: sample.headingDegrees,
      latitude: sample.latitude,
      longitude: sample.longitude,
      monitoringState: sample.monitoringState,
      placeId: sample.placeId,
      safetyLocationId: sample.safetyLocationId,
      source: sample.source ?? LocationSampleSource.UNKNOWN,
      speedMetersPerSecond: sample.speedMetersPerSecond,
    };
  }

  private async assertOwnedReferences(
    userId: string,
    samples: NormalizedVeraLocationSample[],
  ): Promise<void> {
    const alertSessionIds = [
      ...new Set(
        samples.map((sample) => sample.alertSessionId).filter(Boolean),
      ),
    ] as string[];
    const safetyLocationIds = [
      ...new Set(
        samples.map((sample) => sample.safetyLocationId).filter(Boolean),
      ),
    ] as string[];

    if (alertSessionIds.length > 0) {
      const sessions = await this.prisma.alertSession.findMany({
        where: { id: { in: alertSessionIds }, userId },
        select: { id: true },
      });
      const ownedIds = new Set(sessions.map((session) => session.id));

      if (alertSessionIds.some((id) => !ownedIds.has(id))) {
        throw new NotFoundException('Alert session not found');
      }
    }

    if (safetyLocationIds.length > 0) {
      const locations = await this.prisma.safetyLocation.findMany({
        where: { id: { in: safetyLocationIds }, userId },
        select: { id: true },
      });
      const ownedIds = new Set(locations.map((location) => location.id));

      if (safetyLocationIds.some((id) => !ownedIds.has(id))) {
        throw new NotFoundException('Safety location not found');
      }
    }
  }

  private parseLimit(value?: string): number {
    if (!value) {
      return 100;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed)) {
      return 100;
    }

    return Math.max(1, Math.min(500, parsed));
  }

  private toResponse(sample: VeraLocationSample) {
    return {
      id: sample.id,
      userId: sample.userId,
      alertSessionId: sample.alertSessionId,
      safetyLocationId: sample.safetyLocationId,
      latitude: sample.latitude,
      longitude: sample.longitude,
      accuracyMeters: sample.accuracyMeters,
      altitudeMeters: sample.altitudeMeters,
      speedMetersPerSecond: sample.speedMetersPerSecond,
      headingDegrees: sample.headingDegrees,
      source: sample.source,
      monitoringState: sample.monitoringState,
      address: sample.address,
      formattedAddress: sample.formattedAddress,
      placeId: sample.placeId,
      capturedAt: sample.capturedAt,
      createdAt: sample.createdAt,
    };
  }
}
