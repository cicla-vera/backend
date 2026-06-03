import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertStatus,
  EvidenceAuditAction,
  type EvidenceAuditEvent,
  EvidenceType,
  type AlertSession,
  type EvidenceRecord,
  type Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { UploadEvidenceDto } from './dto/upload-evidence.dto';
import { EvidenceStorageService } from './evidence-storage.service';

export const MAX_EVIDENCE_UPLOAD_BYTES = 25 * 1024 * 1024;

type EvidenceMetadataValue = string | number | boolean | null;
type EvidenceMetadataPayload = Record<string, EvidenceMetadataValue>;
type EvidenceAuditMetadataPayload = Record<string, EvidenceMetadataValue>;

export type UploadedEvidenceFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type EvidenceRecordResponse = {
  id: string;
  userId: string;
  alertSessionId: string;
  type: EvidenceType;
  size: number;
  mimeType: string;
  originalName: string | null;
  contentHash: string;
  hashAlgorithm: string;
  hashedAt: Date;
  hiddenFromUserAt: Date | null;
  retentionUntil: Date | null;
  deletedAt: Date | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

type EvidenceVerificationResponse = {
  evidenceRecordId: string;
  hashAlgorithm: string;
  storedHash: string;
  calculatedHash: string;
  matches: boolean;
  checkedAt: Date;
};

type CreateAuditEventInput = {
  userId: string;
  evidenceRecordId: string;
  action: EvidenceAuditAction;
  contentHash?: string;
  metadata?: EvidenceAuditMetadataPayload;
};

const MAX_METADATA_KEYS = 32;
const MAX_METADATA_KEY_LENGTH = 40;
const MAX_METADATA_STRING_LENGTH = 240;
const MAX_ORIGINAL_NAME_LENGTH = 240;
const HASH_ALGORITHM = 'SHA-256';
const NODE_HASH_ALGORITHM = 'sha256';
export const EVIDENCE_RETENTION_DAYS = 180;

const FILE_MIME_TYPES = new Set([
  'application/json',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'text/plain',
]);

@Injectable()
export class EvidenceService {
  constructor(
    private prisma: PrismaService,
    private evidenceStorage: EvidenceStorageService,
  ) {}

  async upload(
    userId: string,
    alertSessionId: string,
    dto: UploadEvidenceDto,
    file?: UploadedEvidenceFile,
  ): Promise<EvidenceRecordResponse> {
    this.validateFile(file);
    this.validateMimeType(dto.type, file.mimetype);

    const session = await this.findOwnedSession(userId, alertSessionId);

    if (session.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException(
        'Evidence can only be uploaded to active alert sessions.',
      );
    }

    const metadata = this.parseMetadata(dto.metadata);
    const contentHash = this.calculateContentHash(file.buffer);
    const hashedAt = new Date();
    const upload = await this.evidenceStorage.uploadEvidence({
      userId,
      alertSessionId,
      fileName: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
    });

    const record = await this.prisma.$transaction(async (tx) => {
      const evidenceRecord = await tx.evidenceRecord.create({
        data: {
          userId,
          alertSessionId,
          type: dto.type,
          size: file.size,
          mimeType: file.mimetype,
          originalName: this.normalizeOriginalName(file.originalname),
          storagePath: upload.path,
          contentHash,
          hashAlgorithm: HASH_ALGORITHM,
          hashedAt,
          metadata,
        },
      });

      await tx.alertEvent.create({
        data: {
          userId,
          alertSessionId,
          type: AlertEventType.EVIDENCE_UPLOADED,
          message: 'Evidence uploaded.',
          metadata: {
            evidenceRecordId: evidenceRecord.id,
            evidenceType: evidenceRecord.type,
            mimeType: evidenceRecord.mimeType,
            size: evidenceRecord.size,
            contentHash: evidenceRecord.contentHash,
            hashAlgorithm: evidenceRecord.hashAlgorithm,
          },
        },
      });

      await this.createAuditEvent(tx, {
        userId,
        evidenceRecordId: evidenceRecord.id,
        action: EvidenceAuditAction.UPLOADED,
        contentHash: evidenceRecord.contentHash,
        metadata: {
          alertSessionId,
          evidenceType: evidenceRecord.type,
          mimeType: evidenceRecord.mimeType,
          size: evidenceRecord.size,
        },
      });

      return evidenceRecord;
    });

    return this.toResponse(record);
  }

  async findAll(
    userId: string,
    alertSessionId: string,
  ): Promise<EvidenceRecordResponse[]> {
    await this.findOwnedSession(userId, alertSessionId);

    const records = await this.prisma.evidenceRecord.findMany({
      where: {
        userId,
        alertSessionId,
        hiddenFromUserAt: null,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => this.toResponse(record));
  }

  async hideFromUser(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceRecordResponse> {
    const evidenceRecord = await this.findOwnedEvidenceRecord(
      userId,
      alertSessionId,
      evidenceRecordId,
    );

    if (evidenceRecord.hiddenFromUserAt) {
      return this.toResponse(evidenceRecord);
    }

    const hiddenFromUserAt = new Date();
    const retentionUntil = this.calculateRetentionUntil(hiddenFromUserAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.evidenceRecord.update({
        where: { id: evidenceRecord.id },
        data: {
          hiddenFromUserAt,
          retentionUntil,
        },
      });

      await this.createAuditEvent(tx, {
        userId,
        evidenceRecordId: record.id,
        action: EvidenceAuditAction.HIDDEN_FROM_USER,
        contentHash: record.contentHash,
        metadata: {
          alertSessionId,
          retentionUntil: retentionUntil.toISOString(),
        },
      });

      return record;
    });

    return this.toResponse(updated);
  }

  async verify(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceVerificationResponse> {
    const evidenceRecord = await this.findOwnedEvidenceRecord(
      userId,
      alertSessionId,
      evidenceRecordId,
    );
    const download = await this.evidenceStorage.downloadEvidence(
      evidenceRecord.storagePath,
    );
    const calculatedHash = this.calculateContentHash(
      Buffer.from(download.body),
    );
    const checkedAt = new Date();
    const matches = calculatedHash === evidenceRecord.contentHash;

    await this.createAuditEvent(this.prisma, {
      userId,
      evidenceRecordId: evidenceRecord.id,
      action: EvidenceAuditAction.HASH_VERIFIED,
      contentHash: calculatedHash,
      metadata: {
        alertSessionId,
        matches,
        storedHash: evidenceRecord.contentHash,
      },
    });

    return {
      evidenceRecordId: evidenceRecord.id,
      hashAlgorithm: evidenceRecord.hashAlgorithm,
      storedHash: evidenceRecord.contentHash,
      calculatedHash,
      matches,
      checkedAt,
    };
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

  private async findOwnedEvidenceRecord(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceRecord> {
    const evidenceRecord = await this.prisma.evidenceRecord.findFirst({
      where: {
        id: evidenceRecordId,
        userId,
        alertSessionId,
        deletedAt: null,
      },
    });

    if (!evidenceRecord) {
      throw new NotFoundException('Evidence record not found');
    }

    return evidenceRecord;
  }

  private async createAuditEvent(
    client: Prisma.TransactionClient | PrismaService,
    input: CreateAuditEventInput,
  ): Promise<EvidenceAuditEvent> {
    const previousEvent = await client.evidenceAuditEvent.findFirst({
      where: { evidenceRecordId: input.evidenceRecordId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { eventHash: true },
    });
    const createdAt = new Date();
    const eventHash = this.calculateAuditEventHash({
      ...input,
      previousEventHash: previousEvent?.eventHash,
      createdAt,
    });

    return client.evidenceAuditEvent.create({
      data: {
        userId: input.userId,
        evidenceRecordId: input.evidenceRecordId,
        action: input.action,
        contentHash: input.contentHash,
        hashAlgorithm: HASH_ALGORITHM,
        previousEventHash: previousEvent?.eventHash,
        eventHash,
        metadata: input.metadata,
        createdAt,
      },
    });
  }

  private validateFile(
    file?: UploadedEvidenceFile,
  ): asserts file is UploadedEvidenceFile {
    if (!file) {
      throw new BadRequestException('Evidence file is required.');
    }

    if (!Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException(
        'Evidence file must be uploaded in memory.',
      );
    }

    if (file.size <= 0) {
      throw new BadRequestException('Evidence file cannot be empty.');
    }

    if (file.size > MAX_EVIDENCE_UPLOAD_BYTES) {
      throw new BadRequestException('Evidence file is too large.');
    }
  }

  private validateMimeType(type: EvidenceType, mimeType: string): void {
    const normalizedMimeType = mimeType.toLowerCase();

    if (
      type === EvidenceType.AUDIO &&
      normalizedMimeType.startsWith('audio/')
    ) {
      return;
    }

    if (
      type === EvidenceType.VIDEO &&
      normalizedMimeType.startsWith('video/')
    ) {
      return;
    }

    if (
      type === EvidenceType.IMAGE &&
      normalizedMimeType.startsWith('image/')
    ) {
      return;
    }

    if (type === EvidenceType.FILE && FILE_MIME_TYPES.has(normalizedMimeType)) {
      return;
    }

    throw new BadRequestException(
      'Evidence type does not match file mime type.',
    );
  }

  private parseMetadata(
    metadata?: string,
  ): EvidenceMetadataPayload | undefined {
    if (!metadata) {
      return undefined;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(metadata);
    } catch {
      throw new BadRequestException('Evidence metadata must be valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('Evidence metadata must be an object.');
    }

    const entries = Object.entries(parsed as Record<string, unknown>);

    if (entries.length > MAX_METADATA_KEYS) {
      throw new BadRequestException('Evidence metadata has too many keys.');
    }

    const sanitized: EvidenceMetadataPayload = {};

    for (const [key, value] of entries) {
      if (key.length === 0 || key.length > MAX_METADATA_KEY_LENGTH) {
        throw new BadRequestException(
          'Evidence metadata contains an invalid key.',
        );
      }

      if (typeof value === 'string') {
        if (value.length > MAX_METADATA_STRING_LENGTH) {
          throw new BadRequestException(
            'Evidence metadata string value is too long.',
          );
        }

        sanitized[key] = value;
        continue;
      }

      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          throw new BadRequestException(
            'Evidence metadata contains an invalid number.',
          );
        }

        sanitized[key] = value;
        continue;
      }

      if (typeof value === 'boolean' || value === null) {
        sanitized[key] = value;
        continue;
      }

      throw new BadRequestException(
        'Evidence metadata only accepts string, number, boolean, or null values.',
      );
    }

    return sanitized;
  }

  private normalizeOriginalName(originalName: string): string | null {
    const name = basename(originalName.trim().replace(/\\/g, '/')).slice(
      0,
      MAX_ORIGINAL_NAME_LENGTH,
    );

    return name || null;
  }

  private calculateContentHash(body: Buffer): string {
    return createHash(NODE_HASH_ALGORITHM).update(body).digest('hex');
  }

  private calculateRetentionUntil(hiddenFromUserAt: Date): Date {
    const retentionUntil = new Date(hiddenFromUserAt);
    retentionUntil.setUTCDate(
      retentionUntil.getUTCDate() + EVIDENCE_RETENTION_DAYS,
    );

    return retentionUntil;
  }

  private calculateAuditEventHash(
    input: CreateAuditEventInput & {
      previousEventHash?: string;
      createdAt: Date;
    },
  ): string {
    return createHash(NODE_HASH_ALGORITHM)
      .update(
        this.stableStringify({
          action: input.action,
          contentHash: input.contentHash ?? null,
          createdAt: input.createdAt.toISOString(),
          evidenceRecordId: input.evidenceRecordId,
          hashAlgorithm: HASH_ALGORITHM,
          metadata: input.metadata ?? null,
          previousEventHash: input.previousEventHash ?? null,
          userId: input.userId,
        }),
      )
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

  private toResponse(record: EvidenceRecord): EvidenceRecordResponse {
    return {
      id: record.id,
      userId: record.userId,
      alertSessionId: record.alertSessionId,
      type: record.type,
      size: record.size,
      mimeType: record.mimeType,
      originalName: record.originalName,
      contentHash: record.contentHash,
      hashAlgorithm: record.hashAlgorithm,
      hashedAt: record.hashedAt,
      hiddenFromUserAt: record.hiddenFromUserAt,
      retentionUntil: record.retentionUntil,
      deletedAt: record.deletedAt,
      metadata: record.metadata,
      createdAt: record.createdAt,
    };
  }
}
