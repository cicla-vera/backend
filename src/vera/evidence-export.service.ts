import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type EvidenceAuditEvent,
  type EvidenceRecord,
  type Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EvidenceTimestampService,
  type EvidenceTimestampReceipt,
} from './evidence-timestamp.service';

const MANIFEST_VERSION = 'vera-evidence-export-v1';
const HASH_ALGORITHM = 'SHA-256';
const NODE_HASH_ALGORITHM = 'sha256';

type ExportSession = Prisma.AlertSessionGetPayload<{
  include: {
    events: true;
    locationSamples: true;
    evidenceRecords: {
      include: {
        auditEvents: true;
        analyses: true;
      };
    };
  };
}>;

type ExportEvidenceRecord = ExportSession['evidenceRecords'][number];

type EvidenceExportManifestBody = {
  manifestVersion: typeof MANIFEST_VERSION;
  generatedAt: string;
  generatedBy: 'cicla-backend';
  alertSession: {
    id: string;
    userId: string;
    trigger: string;
    status: string;
    level: string;
    startedAt: string;
    endedAt: string | null;
    criticalEscalatedAt: string | null;
    initialLatitude: number | null;
    initialLongitude: number | null;
    createdAt: string;
    updatedAt: string;
  };
  evidenceRecords: EvidenceExportRecordManifest[];
  timelineEvents: EvidenceExportTimelineEventManifest[];
  locationSamples: EvidenceExportLocationSampleManifest[];
  aiAnalyses: EvidenceExportAnalysisManifest[];
  custody: EvidenceExportCustodyManifest;
  technicalValidity: {
    status: 'TECHNICAL_MANIFEST_ONLY';
    guarantees: string[];
    limitations: string[];
  };
};

type EvidenceExportRecordManifest = {
  id: string;
  type: string;
  size: number;
  mimeType: string;
  originalName: string | null;
  storagePath: string;
  contentHash: string;
  hashAlgorithm: string;
  hashedAt: string;
  metadata: Prisma.JsonValue | null;
  hiddenFromUserAt: string | null;
  retentionUntil: string | null;
  createdAt: string;
  auditEvents: EvidenceExportAuditEventManifest[];
  analysisIds: string[];
  locationSampleIds: string[];
};

type EvidenceExportAuditEventManifest = {
  id: string;
  action: string;
  contentHash: string | null;
  hashAlgorithm: string;
  previousEventHash: string | null;
  eventHash: string;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
};

type EvidenceExportTimelineEventManifest = {
  id: string;
  type: string;
  message: string | null;
  metadata: Prisma.JsonValue | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
};

type EvidenceExportLocationSampleManifest = {
  id: string;
  evidenceRecordId: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  speedMetersPerSecond: number | null;
  headingDegrees: number | null;
  source: string;
  capturedAt: string;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
};

type EvidenceExportAnalysisManifest = {
  id: string;
  evidenceRecordId: string;
  analysisId: string | null;
  analysisVersion: string | null;
  status: string;
  attemptCount: number;
  riskLevel: string | null;
  suggestedAlertLevel: string | null;
  confidence: number | null;
  summary: string | null;
  detectedSignals: Prisma.JsonValue | null;
  shouldEscalate: boolean | null;
  recommendedAction: string | null;
  evidenceWindow: Prisma.JsonValue | null;
  transcription: Prisma.JsonValue | null;
  acousticEvents: Prisma.JsonValue | null;
  threatMatches: Prisma.JsonValue | null;
  providerMetadata: Prisma.JsonValue | null;
  failureReason: string | null;
  processingStartedAt: string | null;
  processingFinishedAt: string | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
};

type EvidenceExportCustodyManifest = {
  hashAlgorithm: typeof HASH_ALGORITHM;
  evidenceRecordCount: number;
  auditEventCount: number;
  allAuditChainsValid: boolean;
  auditChains: EvidenceAuditChainValidation[];
  audioChunkSequences: EvidenceAudioChunkSequenceValidation[];
};

type EvidenceAuditChainValidation = {
  evidenceRecordId: string;
  auditEventCount: number;
  firstEventHash: string | null;
  lastEventHash: string | null;
  isValid: boolean;
  errors: string[];
};

type EvidenceAudioChunkSequenceValidation = {
  sequenceId: string;
  chunkCount: number;
  isValid: boolean;
  firstChunkHash: string | null;
  lastChunkHash: string | null;
  errors: string[];
};

type EvidenceExportManifestIntegrity = {
  manifestHashAlgorithm: typeof HASH_ALGORITHM;
  manifestHash: string;
  manifestHashScope: string;
};

export type EvidenceExportManifest = EvidenceExportManifestBody & {
  integrity: EvidenceExportManifestIntegrity;
  trustedTimestamp: EvidenceTimestampReceipt;
};

type AudioChunkRecord = {
  evidenceRecordId: string;
  sequenceId: string;
  chunkHash: string;
  previousChunkHash: string | null;
  chunkIndex: number | null;
  createdAt: Date;
};

@Injectable()
export class EvidenceExportService {
  constructor(
    private prisma: PrismaService,
    private timestampService: EvidenceTimestampService,
  ) {}

  async createManifest(
    userId: string,
    alertSessionId: string,
  ): Promise<EvidenceExportManifest> {
    const session = await this.prisma.alertSession.findFirst({
      where: { id: alertSessionId, userId },
      include: {
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        locationSamples: {
          orderBy: [{ capturedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
        evidenceRecords: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            auditEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            analyses: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Alert session not found');
    }

    const generatedAt = new Date().toISOString();
    const manifestBody: EvidenceExportManifestBody = {
      manifestVersion: MANIFEST_VERSION,
      generatedAt,
      generatedBy: 'cicla-backend',
      alertSession: this.toAlertSessionManifest(session),
      evidenceRecords: session.evidenceRecords.map((record) =>
        this.toEvidenceRecordManifest(record, session.locationSamples),
      ),
      timelineEvents: session.events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        metadata: event.metadata,
        latitude: event.latitude,
        longitude: event.longitude,
        createdAt: this.toIso(event.createdAt),
      })),
      locationSamples: session.locationSamples.map((sample) => ({
        id: sample.id,
        evidenceRecordId: sample.evidenceRecordId,
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracyMeters: sample.accuracyMeters,
        altitudeMeters: sample.altitudeMeters,
        speedMetersPerSecond: sample.speedMetersPerSecond,
        headingDegrees: sample.headingDegrees,
        source: sample.source,
        capturedAt: this.toIso(sample.capturedAt),
        metadata: sample.metadata,
        createdAt: this.toIso(sample.createdAt),
      })),
      aiAnalyses: session.evidenceRecords.flatMap((record) =>
        record.analyses.map((analysis) => ({
          id: analysis.id,
          evidenceRecordId: analysis.evidenceRecordId,
          analysisId: analysis.analysisId,
          analysisVersion: analysis.analysisVersion,
          status: analysis.status,
          attemptCount: analysis.attemptCount,
          riskLevel: analysis.riskLevel,
          suggestedAlertLevel: analysis.suggestedAlertLevel,
          confidence: analysis.confidence,
          summary: analysis.summary,
          detectedSignals: analysis.detectedSignals,
          shouldEscalate: analysis.shouldEscalate,
          recommendedAction: analysis.recommendedAction,
          evidenceWindow: analysis.evidenceWindow,
          transcription: analysis.transcription,
          acousticEvents: analysis.acousticEvents,
          threatMatches: analysis.threatMatches,
          providerMetadata: analysis.providerMetadata,
          failureReason: analysis.failureReason,
          processingStartedAt: this.toIsoOrNull(analysis.processingStartedAt),
          processingFinishedAt: this.toIsoOrNull(analysis.processingFinishedAt),
          latencyMs: analysis.latencyMs,
          createdAt: this.toIso(analysis.createdAt),
          updatedAt: this.toIso(analysis.updatedAt),
        })),
      ),
      custody: this.toCustodyManifest(session.evidenceRecords),
      technicalValidity: {
        status: 'TECHNICAL_MANIFEST_ONLY',
        guarantees: [
          'Evidence file hashes are SHA-256 digests calculated by the backend at upload time.',
          'Custody audit events are chained per evidence record with SHA-256 event hashes.',
          'The manifest hash binds the technical manifest fields before timestamp receipt attachment.',
        ],
        limitations: [
          'This service is internal and does not expose a public evidence export endpoint.',
          'The current timestamp receipt uses backend system time unless an external trusted timestamp provider is implemented.',
          'Legal admissibility still depends on consent, procedural handling, expert review, and court acceptance.',
        ],
      },
    };
    const manifestHash = this.calculateStableHash(manifestBody);
    const trustedTimestamp = await this.timestampService.createTimestampReceipt(
      {
        digest: manifestHash,
        hashAlgorithm: HASH_ALGORITHM,
        purpose: 'vera-evidence-export-manifest',
      },
    );

    return {
      ...manifestBody,
      integrity: {
        manifestHashAlgorithm: HASH_ALGORITHM,
        manifestHash,
        manifestHashScope:
          'All manifest fields except integrity and trustedTimestamp.',
      },
      trustedTimestamp,
    };
  }

  private toAlertSessionManifest(session: ExportSession) {
    return {
      id: session.id,
      userId: session.userId,
      trigger: session.trigger,
      status: session.status,
      level: session.level,
      startedAt: this.toIso(session.startedAt),
      endedAt: this.toIsoOrNull(session.endedAt),
      criticalEscalatedAt: this.toIsoOrNull(session.criticalEscalatedAt),
      initialLatitude: session.initialLatitude,
      initialLongitude: session.initialLongitude,
      createdAt: this.toIso(session.createdAt),
      updatedAt: this.toIso(session.updatedAt),
    };
  }

  private toEvidenceRecordManifest(
    record: ExportEvidenceRecord,
    locationSamples: ExportSession['locationSamples'],
  ): EvidenceExportRecordManifest {
    return {
      id: record.id,
      type: record.type,
      size: record.size,
      mimeType: record.mimeType,
      originalName: record.originalName,
      storagePath: record.storagePath,
      contentHash: record.contentHash,
      hashAlgorithm: record.hashAlgorithm,
      hashedAt: this.toIso(record.hashedAt),
      metadata: record.metadata,
      hiddenFromUserAt: this.toIsoOrNull(record.hiddenFromUserAt),
      retentionUntil: this.toIsoOrNull(record.retentionUntil),
      createdAt: this.toIso(record.createdAt),
      auditEvents: record.auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        contentHash: event.contentHash,
        hashAlgorithm: event.hashAlgorithm,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        metadata: event.metadata,
        createdAt: this.toIso(event.createdAt),
      })),
      analysisIds: record.analyses.map((analysis) => analysis.id),
      locationSampleIds: locationSamples
        .filter((sample) => sample.evidenceRecordId === record.id)
        .map((sample) => sample.id),
    };
  }

  private toCustodyManifest(
    records: ExportSession['evidenceRecords'],
  ): EvidenceExportCustodyManifest {
    const auditChains = records.map((record) =>
      this.validateAuditChain(record),
    );

    return {
      hashAlgorithm: HASH_ALGORITHM,
      evidenceRecordCount: records.length,
      auditEventCount: records.reduce(
        (sum, record) => sum + record.auditEvents.length,
        0,
      ),
      allAuditChainsValid: auditChains.every((chain) => chain.isValid),
      auditChains,
      audioChunkSequences: this.validateAudioChunkSequences(records),
    };
  }

  private validateAuditChain(
    record: ExportEvidenceRecord,
  ): EvidenceAuditChainValidation {
    const errors: string[] = [];
    let previousHash: string | null = null;

    for (const event of record.auditEvents) {
      if (event.previousEventHash !== previousHash) {
        errors.push(`audit_event_${event.id}_previous_hash_mismatch`);
      }

      const expectedHash = this.calculateAuditEventHash(event);

      if (event.eventHash !== expectedHash) {
        errors.push(`audit_event_${event.id}_event_hash_mismatch`);
      }

      previousHash = event.eventHash;
    }

    return {
      evidenceRecordId: record.id,
      auditEventCount: record.auditEvents.length,
      firstEventHash: record.auditEvents[0]?.eventHash ?? null,
      lastEventHash: previousHash,
      isValid: errors.length === 0,
      errors,
    };
  }

  private validateAudioChunkSequences(
    records: ExportSession['evidenceRecords'],
  ): EvidenceAudioChunkSequenceValidation[] {
    const chunks = records
      .map((record) => this.toAudioChunkRecord(record))
      .filter((record): record is AudioChunkRecord => Boolean(record));
    const grouped = new Map<string, AudioChunkRecord[]>();

    for (const chunk of chunks) {
      const group = grouped.get(chunk.sequenceId) ?? [];
      group.push(chunk);
      grouped.set(chunk.sequenceId, group);
    }

    return [...grouped.entries()].map(([sequenceId, sequenceChunks]) => {
      const sortedChunks = sequenceChunks.sort((left, right) => {
        if (left.chunkIndex !== null && right.chunkIndex !== null) {
          return left.chunkIndex - right.chunkIndex;
        }

        return left.createdAt.getTime() - right.createdAt.getTime();
      });
      const errors: string[] = [];
      let previousChunkHash: string | null = null;

      for (const chunk of sortedChunks) {
        if (chunk.previousChunkHash !== previousChunkHash) {
          errors.push(
            `evidence_${chunk.evidenceRecordId}_audio_previous_hash_mismatch`,
          );
        }

        const record = records.find(({ id }) => id === chunk.evidenceRecordId);

        if (record && chunk.chunkHash !== record.contentHash) {
          errors.push(`evidence_${record.id}_audio_content_hash_mismatch`);
        }

        previousChunkHash = chunk.chunkHash;
      }

      return {
        sequenceId,
        chunkCount: sortedChunks.length,
        isValid: errors.length === 0,
        firstChunkHash: sortedChunks[0]?.chunkHash ?? null,
        lastChunkHash: sortedChunks[sortedChunks.length - 1]?.chunkHash ?? null,
        errors,
      };
    });
  }

  private toAudioChunkRecord(record: EvidenceRecord): AudioChunkRecord | null {
    const metadata = this.getJsonObject(record.metadata);
    const sequenceId = this.getStringValue(metadata, 'audioChunkSequenceId');
    const chunkHash = this.getStringValue(metadata, 'audioChunkHash');

    if (!sequenceId || !chunkHash) {
      return null;
    }

    return {
      evidenceRecordId: record.id,
      sequenceId,
      chunkHash,
      previousChunkHash: this.getStringValue(
        metadata,
        'audioPreviousChunkHash',
      ),
      chunkIndex: this.getNumberValue(metadata, 'audioChunkIndex'),
      createdAt: record.createdAt,
    };
  }

  private getJsonObject(
    value: Prisma.JsonValue | null,
  ): Prisma.JsonObject | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value;
  }

  private getStringValue(
    object: Prisma.JsonObject | null,
    key: string,
  ): string | null {
    const value = object?.[key];

    return typeof value === 'string' ? value : null;
  }

  private getNumberValue(
    object: Prisma.JsonObject | null,
    key: string,
  ): number | null {
    const value = object?.[key];

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private calculateAuditEventHash(event: EvidenceAuditEvent): string {
    return createHash(NODE_HASH_ALGORITHM)
      .update(
        this.stableStringify({
          action: event.action,
          contentHash: event.contentHash ?? null,
          createdAt: event.createdAt.toISOString(),
          evidenceRecordId: event.evidenceRecordId,
          hashAlgorithm: event.hashAlgorithm,
          metadata: event.metadata ?? null,
          previousEventHash: event.previousEventHash ?? null,
          userId: event.userId,
        }),
      )
      .digest('hex');
  }

  private calculateStableHash(value: unknown): string {
    return createHash(NODE_HASH_ALGORITHM)
      .update(this.stableStringify(value))
      .digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return `{${entries
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`,
      )
      .join(',')}}`;
  }

  private toIso(date: Date): string {
    return date.toISOString();
  }

  private toIsoOrNull(date: Date | null): string | null {
    return date ? this.toIso(date) : null;
  }
}
