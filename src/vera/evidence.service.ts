import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  AlertStatus,
  EvidenceType,
  type AlertSession,
  type EvidenceRecord,
  type Prisma,
} from '@prisma/client';
import { basename } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { UploadEvidenceDto } from './dto/upload-evidence.dto';
import { EvidenceStorageService } from './evidence-storage.service';

export const MAX_EVIDENCE_UPLOAD_BYTES = 25 * 1024 * 1024;

type EvidenceMetadataValue = string | number | boolean | null;
type EvidenceMetadataPayload = Record<string, EvidenceMetadataValue>;

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
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_LENGTH = 40;
const MAX_METADATA_STRING_LENGTH = 240;
const MAX_ORIGINAL_NAME_LENGTH = 240;

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
          },
        },
      });

      return evidenceRecord;
    });

    return this.toResponse(record);
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

  private toResponse(record: EvidenceRecord): EvidenceRecordResponse {
    return {
      id: record.id,
      userId: record.userId,
      alertSessionId: record.alertSessionId,
      type: record.type,
      size: record.size,
      mimeType: record.mimeType,
      originalName: record.originalName,
      metadata: record.metadata,
      createdAt: record.createdAt,
    };
  }
}
