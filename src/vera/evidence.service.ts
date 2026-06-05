import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertStatus,
  EvidenceAuditAction,
  EvidenceChunkChainStatus,
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

type EvidenceUploadContract = {
  clientUploadId: string | null;
  chunkSequenceId: string | null;
  chunkIndex: number | null;
  previousChunkHash: string | null;
  chunkChainStatus: EvidenceChunkChainStatus;
};

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
  clientUploadId: string | null;
  chunkSequenceId: string | null;
  chunkIndex: number | null;
  previousChunkHash: string | null;
  chunkChainStatus: EvidenceChunkChainStatus;
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
const SHA_256_PATTERN = /^[a-f0-9]{64}$/i;
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

    const metadata = this.parseMetadata(dto.metadata);
    const contentHash = this.calculateContentHash(file.buffer);
    const uploadContract = this.parseUploadContract(
      dto.type,
      metadata,
      contentHash,
    );
    const existingRecord = await this.findExistingUpload(
      userId,
      alertSessionId,
      uploadContract,
    );

    if (existingRecord) {
      this.assertMatchingIdempotentUpload(
        existingRecord,
        alertSessionId,
        dto.type,
        file.mimetype,
        contentHash,
        uploadContract,
      );

      return this.toResponse(existingRecord);
    }

    const session = await this.findOwnedSession(userId, alertSessionId);

    if (session.status !== AlertStatus.ACTIVE) {
      throw new BadRequestException(
        'Evidence can only be uploaded to active alert sessions.',
      );
    }

    uploadContract.chunkChainStatus = await this.resolveChunkChainStatus(
      userId,
      alertSessionId,
      uploadContract,
    );
    const hashedAt = new Date();
    const upload = await this.evidenceStorage.uploadEvidence({
      userId,
      alertSessionId,
      fileName: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
    });

    let record: EvidenceRecord;

    try {
      record = await this.prisma.$transaction(async (tx) => {
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
            clientUploadId: uploadContract.clientUploadId,
            chunkSequenceId: uploadContract.chunkSequenceId,
            chunkIndex: uploadContract.chunkIndex,
            previousChunkHash: uploadContract.previousChunkHash,
            chunkChainStatus: uploadContract.chunkChainStatus,
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
              clientUploadId: evidenceRecord.clientUploadId,
              chunkSequenceId: evidenceRecord.chunkSequenceId,
              chunkIndex: evidenceRecord.chunkIndex,
              chunkChainStatus: evidenceRecord.chunkChainStatus,
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
            clientUploadId: evidenceRecord.clientUploadId,
            chunkSequenceId: evidenceRecord.chunkSequenceId,
            chunkIndex: evidenceRecord.chunkIndex,
            previousChunkHash: evidenceRecord.previousChunkHash,
            chunkChainStatus: evidenceRecord.chunkChainStatus,
          },
        });

        await this.reconcilePendingChild(tx, evidenceRecord);

        return evidenceRecord;
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const concurrentRecord = await this.findExistingUpload(
        userId,
        alertSessionId,
        uploadContract,
      );

      if (!concurrentRecord) {
        throw error;
      }

      this.assertMatchingIdempotentUpload(
        concurrentRecord,
        alertSessionId,
        dto.type,
        file.mimetype,
        contentHash,
        uploadContract,
      );
      record = concurrentRecord;
    }

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

  private parseUploadContract(
    type: EvidenceType,
    metadata: EvidenceMetadataPayload | undefined,
    contentHash: string,
  ): EvidenceUploadContract {
    const clientUploadId = this.getOptionalMetadataString(
      metadata,
      'queuedEvidenceUploadId',
    );
    const chunkKeys = [
      'audioChunkSequenceId',
      'audioChunkIndex',
      'audioChunkHash',
      'audioPreviousChunkHash',
    ];
    const hasChunkMetadata = Boolean(
      metadata &&
      chunkKeys.some((key) =>
        Object.prototype.hasOwnProperty.call(metadata, key),
      ),
    );

    if (!hasChunkMetadata) {
      return {
        clientUploadId,
        chunkSequenceId: null,
        chunkIndex: null,
        previousChunkHash: null,
        chunkChainStatus: EvidenceChunkChainStatus.NOT_APPLICABLE,
      };
    }

    if (type !== EvidenceType.AUDIO) {
      throw new BadRequestException(
        'Audio chunk metadata can only be used with audio evidence.',
      );
    }

    const chunkSequenceId = this.getRequiredMetadataString(
      metadata,
      'audioChunkSequenceId',
    );
    const chunkIndex = this.getRequiredMetadataInteger(
      metadata,
      'audioChunkIndex',
    );
    const suppliedChunkHash = this.getOptionalMetadataHash(
      metadata,
      'audioChunkHash',
    );
    const previousChunkHash = this.getOptionalMetadataHash(
      metadata,
      'audioPreviousChunkHash',
    );

    if (suppliedChunkHash && suppliedChunkHash !== contentHash) {
      throw new BadRequestException(
        'Audio chunk hash does not match the uploaded file.',
      );
    }

    if (previousChunkHash === contentHash) {
      throw new BadRequestException(
        'Audio chunk cannot reference its own hash as the previous chunk.',
      );
    }

    if (metadata) {
      metadata.audioChunkHash = contentHash;
    }

    return {
      clientUploadId,
      chunkSequenceId,
      chunkIndex,
      previousChunkHash,
      chunkChainStatus:
        previousChunkHash === null
          ? EvidenceChunkChainStatus.ROOT
          : EvidenceChunkChainStatus.PENDING_PREVIOUS,
    };
  }

  private async findExistingUpload(
    userId: string,
    alertSessionId: string,
    contract: EvidenceUploadContract,
  ): Promise<EvidenceRecord | null> {
    if (contract.clientUploadId) {
      const existingByClientId = await this.prisma.evidenceRecord.findFirst({
        where: {
          userId,
          clientUploadId: contract.clientUploadId,
        },
      });

      if (existingByClientId) {
        return existingByClientId;
      }
    }

    if (contract.chunkSequenceId !== null && contract.chunkIndex !== null) {
      return this.prisma.evidenceRecord.findFirst({
        where: {
          userId,
          alertSessionId,
          chunkSequenceId: contract.chunkSequenceId,
          chunkIndex: contract.chunkIndex,
        },
      });
    }

    return null;
  }

  private assertMatchingIdempotentUpload(
    record: EvidenceRecord,
    alertSessionId: string,
    type: EvidenceType,
    mimeType: string,
    contentHash: string,
    contract: EvidenceUploadContract,
  ): void {
    const matches =
      record.alertSessionId === alertSessionId &&
      record.type === type &&
      record.mimeType === mimeType &&
      record.contentHash === contentHash &&
      record.chunkSequenceId === contract.chunkSequenceId &&
      record.chunkIndex === contract.chunkIndex &&
      record.previousChunkHash === contract.previousChunkHash;

    if (!matches) {
      throw new BadRequestException(
        'Evidence upload identifier was already used for different content.',
      );
    }
  }

  private async resolveChunkChainStatus(
    userId: string,
    alertSessionId: string,
    contract: EvidenceUploadContract,
  ): Promise<EvidenceChunkChainStatus> {
    if (contract.chunkSequenceId === null || contract.chunkIndex === null) {
      return EvidenceChunkChainStatus.NOT_APPLICABLE;
    }

    if (contract.previousChunkHash === null) {
      return EvidenceChunkChainStatus.ROOT;
    }

    if (contract.chunkIndex === 0) {
      throw new BadRequestException(
        'Audio chunk index zero cannot reference a previous chunk.',
      );
    }

    const previousChunk = await this.prisma.evidenceRecord.findFirst({
      where: {
        userId,
        alertSessionId,
        chunkSequenceId: contract.chunkSequenceId,
        chunkIndex: contract.chunkIndex - 1,
        deletedAt: null,
      },
    });

    if (!previousChunk) {
      return EvidenceChunkChainStatus.PENDING_PREVIOUS;
    }

    if (previousChunk.contentHash !== contract.previousChunkHash) {
      throw new BadRequestException(
        'Audio chunk previous hash does not match the preceding chunk.',
      );
    }

    return EvidenceChunkChainStatus.VERIFIED;
  }

  private async reconcilePendingChild(
    tx: Prisma.TransactionClient,
    record: EvidenceRecord,
  ): Promise<void> {
    if (record.chunkSequenceId == null || record.chunkIndex == null) {
      return;
    }

    const pendingChild = await tx.evidenceRecord.findFirst({
      where: {
        userId: record.userId,
        alertSessionId: record.alertSessionId,
        chunkSequenceId: record.chunkSequenceId,
        chunkIndex: record.chunkIndex + 1,
        previousChunkHash: record.contentHash,
        chunkChainStatus: EvidenceChunkChainStatus.PENDING_PREVIOUS,
        deletedAt: null,
      },
    });

    if (!pendingChild) {
      return;
    }

    const verifiedChild = await tx.evidenceRecord.update({
      where: { id: pendingChild.id },
      data: { chunkChainStatus: EvidenceChunkChainStatus.VERIFIED },
    });

    await this.createAuditEvent(tx, {
      userId: verifiedChild.userId,
      evidenceRecordId: verifiedChild.id,
      action: EvidenceAuditAction.CHUNK_CHAIN_VERIFIED,
      contentHash: verifiedChild.contentHash,
      metadata: {
        alertSessionId: verifiedChild.alertSessionId,
        chunkSequenceId: verifiedChild.chunkSequenceId,
        chunkIndex: verifiedChild.chunkIndex,
        previousEvidenceRecordId: record.id,
        previousChunkHash: record.contentHash,
        chunkChainStatus: verifiedChild.chunkChainStatus,
      },
    });
  }

  private getOptionalMetadataString(
    metadata: EvidenceMetadataPayload | undefined,
    key: string,
  ): string | null {
    const value = metadata?.[key];

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(
        `Evidence metadata ${key} must be a non-empty string.`,
      );
    }

    const normalized = value.trim();

    if (metadata) {
      metadata[key] = normalized;
    }

    return normalized;
  }

  private getRequiredMetadataString(
    metadata: EvidenceMetadataPayload | undefined,
    key: string,
  ): string {
    const value = this.getOptionalMetadataString(metadata, key);

    if (!value) {
      throw new BadRequestException(`Evidence metadata ${key} is required.`);
    }

    return value;
  }

  private getRequiredMetadataInteger(
    metadata: EvidenceMetadataPayload | undefined,
    key: string,
  ): number {
    const value = metadata?.[key];

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(
        `Evidence metadata ${key} must be a non-negative integer.`,
      );
    }

    return value;
  }

  private getOptionalMetadataHash(
    metadata: EvidenceMetadataPayload | undefined,
    key: string,
  ): string | null {
    const value = metadata?.[key];

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
      throw new BadRequestException(
        `Evidence metadata ${key} must be a SHA-256 hash.`,
      );
    }

    const normalized = value.toLowerCase();

    if (metadata) {
      metadata[key] = normalized;
    }

    return normalized;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
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
      clientUploadId: record.clientUploadId,
      chunkSequenceId: record.chunkSequenceId,
      chunkIndex: record.chunkIndex,
      previousChunkHash: record.previousChunkHash,
      chunkChainStatus: record.chunkChainStatus,
      hiddenFromUserAt: record.hiddenFromUserAt,
      retentionUntil: record.retentionUntil,
      deletedAt: record.deletedAt,
      metadata: record.metadata,
      createdAt: record.createdAt,
    };
  }
}
