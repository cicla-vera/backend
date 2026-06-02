import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertStatus,
  LocationSampleSource,
  type AlertLocationSample,
  type AlertSession,
  type EvidenceRecord,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LocationSampleDto,
  RecordLocationSamplesDto,
} from './dto/record-location-samples.dto';

type LocationSampleResponse = {
  id: string;
  alertSessionId: string;
  evidenceRecordId: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  speedMetersPerSecond: number | null;
  headingDegrees: number | null;
  source: LocationSampleSource;
  capturedAt: Date;
  createdAt: Date;
};

type RecordLocationSamplesResponse = {
  alertSessionId: string;
  samples: LocationSampleResponse[];
};

type NormalizedLocationSample = {
  accuracyMeters?: number;
  altitudeMeters?: number;
  capturedAt: Date;
  evidenceRecordId?: string;
  headingDegrees?: number;
  latitude: number;
  longitude: number;
  source: LocationSampleSource;
  speedMetersPerSecond?: number;
};

const MAX_LOCATION_SAMPLES_PER_REQUEST = 50;
const MAX_LOCATION_SAMPLE_FUTURE_MS = 5 * 60 * 1000;
const SESSION_START_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SIGNIFICANT_MOVEMENT_METERS = 100;
const EARTH_RADIUS_METERS = 6371000;

@Injectable()
export class AlertLocationSamplesService {
  constructor(private prisma: PrismaService) {}

  async recordSamples(
    userId: string,
    alertSessionId: string,
    dto: RecordLocationSamplesDto,
  ): Promise<RecordLocationSamplesResponse> {
    const session = await this.findActiveSession(userId, alertSessionId);
    const samples = this.normalizeSamples(dto, session);
    await this.assertOwnedEvidenceRecords(userId, alertSessionId, samples);
    const previousSample = await this.findLatestSample(userId, alertSessionId);

    const createdSamples = await this.prisma.$transaction(async (tx) => {
      const created: AlertLocationSample[] = [];

      for (const sample of samples) {
        created.push(
          await tx.alertLocationSample.create({
            data: {
              userId,
              alertSessionId,
              evidenceRecordId: sample.evidenceRecordId,
              latitude: sample.latitude,
              longitude: sample.longitude,
              accuracyMeters: sample.accuracyMeters,
              altitudeMeters: sample.altitudeMeters,
              speedMetersPerSecond: sample.speedMetersPerSecond,
              headingDegrees: sample.headingDegrees,
              source: sample.source,
              capturedAt: sample.capturedAt,
            },
          }),
        );
      }

      const eventSample = this.findSignificantEventSample(
        previousSample,
        created,
      );

      if (eventSample) {
        await tx.alertEvent.create({
          data: {
            userId,
            alertSessionId,
            type: AlertEventType.LOCATION_UPDATED,
            message: 'Location updated during Vera monitoring.',
            latitude: eventSample.sample.latitude,
            longitude: eventSample.sample.longitude,
            metadata: {
              distanceFromPreviousMeters:
                eventSample.distanceFromPreviousMeters,
              locationSampleId: eventSample.sample.id,
              source: eventSample.sample.source,
            },
          },
        });
      }

      return created;
    });

    return {
      alertSessionId,
      samples: createdSamples.map((sample) => this.toResponse(sample)),
    };
  }

  async findAll(
    userId: string,
    alertSessionId: string,
    limitValue?: string,
  ): Promise<LocationSampleResponse[]> {
    await this.findOwnedSession(userId, alertSessionId);
    const limit = this.parseLimit(limitValue);
    const samples = await this.prisma.alertLocationSample.findMany({
      where: { userId, alertSessionId },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return samples.reverse().map((sample) => this.toResponse(sample));
  }

  private normalizeSamples(
    dto: RecordLocationSamplesDto,
    session: AlertSession,
  ): NormalizedLocationSample[] {
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

    return payloadSamples.map((sample) =>
      this.normalizeSample(sample, session),
    );
  }

  private getSingleSamplePayload(
    dto: RecordLocationSamplesDto,
  ): LocationSampleDto[] {
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
        altitudeMeters: dto.altitudeMeters,
        capturedAt: dto.capturedAt,
        evidenceRecordId: dto.evidenceRecordId,
        headingDegrees: dto.headingDegrees,
        latitude: dto.latitude,
        longitude: dto.longitude,
        source: dto.source,
        speedMetersPerSecond: dto.speedMetersPerSecond,
      },
    ];
  }

  private normalizeSample(
    sample: LocationSampleDto,
    session: AlertSession,
  ): NormalizedLocationSample {
    const capturedAt = new Date(sample.capturedAt);

    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('Invalid location sample timestamp.');
    }

    if (capturedAt.getTime() > Date.now() + MAX_LOCATION_SAMPLE_FUTURE_MS) {
      throw new BadRequestException(
        'Location sample timestamp is too far ahead.',
      );
    }

    if (
      capturedAt.getTime() <
      session.startedAt.getTime() - SESSION_START_CLOCK_SKEW_MS
    ) {
      throw new BadRequestException('Location sample predates alert session.');
    }

    return {
      accuracyMeters: sample.accuracyMeters,
      altitudeMeters: sample.altitudeMeters,
      capturedAt,
      evidenceRecordId: sample.evidenceRecordId,
      headingDegrees: sample.headingDegrees,
      latitude: sample.latitude,
      longitude: sample.longitude,
      source: sample.source ?? LocationSampleSource.UNKNOWN,
      speedMetersPerSecond: sample.speedMetersPerSecond,
    };
  }

  private async assertOwnedEvidenceRecords(
    userId: string,
    alertSessionId: string,
    samples: NormalizedLocationSample[],
  ): Promise<void> {
    const evidenceRecordIds = [
      ...new Set(
        samples.map((sample) => sample.evidenceRecordId).filter(Boolean),
      ),
    ] as string[];

    if (evidenceRecordIds.length === 0) {
      return;
    }

    const records = await this.prisma.evidenceRecord.findMany({
      where: {
        id: { in: evidenceRecordIds },
        userId,
        alertSessionId,
        deletedAt: null,
      },
    });
    const foundIds = new Set(
      records.map((record: EvidenceRecord) => record.id),
    );

    if (evidenceRecordIds.some((id) => !foundIds.has(id))) {
      throw new NotFoundException('Evidence record not found');
    }
  }

  private async findActiveSession(
    userId: string,
    alertSessionId: string,
  ): Promise<AlertSession> {
    const session = await this.findOwnedSession(userId, alertSessionId);

    if (session.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException(
        'Location samples can only be recorded on active alert sessions.',
      );
    }

    return session;
  }

  private async findOwnedSession(
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

  private async findLatestSample(
    userId: string,
    alertSessionId: string,
  ): Promise<AlertLocationSample | null> {
    return this.prisma.alertLocationSample.findFirst({
      where: { userId, alertSessionId },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private findSignificantEventSample(
    previousSample: AlertLocationSample | null,
    createdSamples: AlertLocationSample[],
  ): {
    distanceFromPreviousMeters: number | null;
    sample: AlertLocationSample;
  } | null {
    let baseline = previousSample;

    for (const sample of createdSamples) {
      if (!baseline) {
        return { distanceFromPreviousMeters: null, sample };
      }

      const distance = this.calculateDistanceMeters(baseline, sample);

      if (distance >= SIGNIFICANT_MOVEMENT_METERS) {
        return {
          distanceFromPreviousMeters: Math.round(distance),
          sample,
        };
      }

      baseline = sample;
    }

    return null;
  }

  private calculateDistanceMeters(
    first: Pick<AlertLocationSample, 'latitude' | 'longitude'>,
    second: Pick<AlertLocationSample, 'latitude' | 'longitude'>,
  ): number {
    const firstLatitude = this.toRadians(first.latitude);
    const secondLatitude = this.toRadians(second.latitude);
    const deltaLatitude = this.toRadians(second.latitude - first.latitude);
    const deltaLongitude = this.toRadians(second.longitude - first.longitude);
    const haversine =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(firstLatitude) *
        Math.cos(secondLatitude) *
        Math.sin(deltaLongitude / 2) ** 2;

    return (
      EARTH_RADIUS_METERS *
      2 *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private parseLimit(value?: string): number {
    if (!value) {
      return 100;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('Invalid location sample limit.');
    }

    return Math.min(parsed, 200);
  }

  private toResponse(sample: AlertLocationSample): LocationSampleResponse {
    return {
      id: sample.id,
      alertSessionId: sample.alertSessionId,
      evidenceRecordId: sample.evidenceRecordId,
      latitude: sample.latitude,
      longitude: sample.longitude,
      accuracyMeters: sample.accuracyMeters,
      altitudeMeters: sample.altitudeMeters,
      speedMetersPerSecond: sample.speedMetersPerSecond,
      headingDegrees: sample.headingDegrees,
      source: sample.source,
      capturedAt: sample.capturedAt,
      createdAt: sample.createdAt,
    };
  }
}
