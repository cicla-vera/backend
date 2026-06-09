import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

type SupabaseEvidenceStorageConfig = {
  driver: 'supabase';
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

type LocalEvidenceStorageConfig = {
  driver: 'local';
  bucket: string;
  rootDir: string;
};

type EvidenceStorageConfig =
  | SupabaseEvidenceStorageConfig
  | LocalEvidenceStorageConfig;

type EvidenceBody = ArrayBuffer | Buffer | Uint8Array;

type UploadEvidenceInput = {
  userId: string;
  alertSessionId: string;
  fileName: string;
  contentType: string;
  body: EvidenceBody;
};

type UploadEvidenceResult = {
  bucket: string;
  path: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
};

type DownloadEvidenceResult = {
  bucket: string;
  path: string;
  contentType: string | null;
  size: number | null;
  body: ArrayBuffer;
};

@Injectable()
export class EvidenceStorageService {
  async uploadEvidence(
    input: UploadEvidenceInput,
  ): Promise<UploadEvidenceResult> {
    const config = this.getConfig();
    const path = this.buildEvidencePath(input);

    if (config.driver === 'local') {
      return this.uploadLocalEvidence(config, path, input);
    }

    const response = await this.fetchStorage(
      this.getObjectUrl(config, path),
      {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(config),
          'Content-Type': input.contentType,
          'x-upsert': 'false',
        },
        body: this.toFetchBody(input.body),
      },
      'upload evidence',
    );

    await this.assertStorageResponse(response, 'upload evidence');

    return {
      bucket: config.bucket,
      path,
      contentType: input.contentType,
      size: this.getBodySize(input.body),
      uploadedAt: new Date(),
    };
  }

  async downloadEvidence(path: string): Promise<DownloadEvidenceResult> {
    const config = this.getConfig();

    if (config.driver === 'local') {
      return this.downloadLocalEvidence(config, path);
    }

    const response = await this.fetchStorage(
      this.getObjectUrl(config, path),
      {
        method: 'GET',
        headers: this.getAuthHeaders(config),
      },
      'download evidence',
    );

    await this.assertStorageResponse(response, 'download evidence');

    const body = await response.arrayBuffer();
    const contentLength = response.headers.get('content-length');

    return {
      bucket: config.bucket,
      path,
      contentType: response.headers.get('content-type'),
      size: contentLength ? Number(contentLength) : null,
      body,
    };
  }

  buildEvidencePath(input: {
    userId: string;
    alertSessionId: string;
    fileName: string;
  }): string {
    const safeFileName = this.sanitizeFileName(input.fileName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return [
      'users',
      this.sanitizePathSegment(input.userId),
      'alert-sessions',
      this.sanitizePathSegment(input.alertSessionId),
      `${timestamp}-${randomUUID()}-${safeFileName}`,
    ].join('/');
  }

  private getConfig(): EvidenceStorageConfig {
    const driver = process.env.VERA_EVIDENCE_STORAGE_DRIVER?.trim();
    const bucket =
      process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'vera-evidence';

    if (driver === 'local') {
      return {
        driver,
        bucket,
        rootDir:
          process.env.VERA_EVIDENCE_LOCAL_STORAGE_DIR?.trim() ||
          resolve(process.cwd(), '.vera-evidence-storage'),
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      this.isPlaceholderValue(supabaseUrl) ||
      this.isPlaceholderValue(serviceRoleKey)
    ) {
      throw new InternalServerErrorException(
        'Evidence storage is not configured.',
      );
    }

    return { driver: 'supabase', supabaseUrl, serviceRoleKey, bucket };
  }

  private getObjectUrl(
    config: SupabaseEvidenceStorageConfig,
    path: string,
  ): string {
    return `${config.supabaseUrl}/storage/v1/object/${config.bucket}/${path}`;
  }

  private async uploadLocalEvidence(
    config: LocalEvidenceStorageConfig,
    path: string,
    input: UploadEvidenceInput,
  ): Promise<UploadEvidenceResult> {
    const localPath = this.getLocalObjectPath(config, path);
    const body = Buffer.from(this.toFetchBody(input.body));

    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, body);
    await writeFile(
      this.getLocalMetadataPath(localPath),
      JSON.stringify(
        {
          contentType: input.contentType,
          size: body.byteLength,
          uploadedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    return {
      bucket: config.bucket,
      path,
      contentType: input.contentType,
      size: body.byteLength,
      uploadedAt: new Date(),
    };
  }

  private async downloadLocalEvidence(
    config: LocalEvidenceStorageConfig,
    path: string,
  ): Promise<DownloadEvidenceResult> {
    const localPath = this.getLocalObjectPath(config, path);
    const [body, metadata, fileStat] = await Promise.all([
      readFile(localPath),
      this.readLocalMetadata(localPath),
      stat(localPath),
    ]);

    return {
      bucket: config.bucket,
      path,
      contentType: metadata.contentType ?? null,
      size: metadata.size ?? fileStat.size,
      body: this.toFetchBody(body),
    };
  }

  private async readLocalMetadata(localPath: string): Promise<{
    contentType?: string;
    size?: number;
  }> {
    try {
      const raw = await readFile(this.getLocalMetadataPath(localPath), 'utf8');
      const parsed = JSON.parse(raw) as {
        contentType?: unknown;
        size?: unknown;
      };

      return {
        contentType:
          typeof parsed.contentType === 'string'
            ? parsed.contentType
            : undefined,
        size: typeof parsed.size === 'number' ? parsed.size : undefined,
      };
    } catch {
      return {};
    }
  }

  private getLocalObjectPath(
    config: LocalEvidenceStorageConfig,
    path: string,
  ): string {
    const rootDir = resolve(config.rootDir);
    const localPath = resolve(rootDir, path);

    if (localPath !== rootDir && !localPath.startsWith(`${rootDir}/`)) {
      throw new InternalServerErrorException('Invalid evidence storage path.');
    }

    return localPath;
  }

  private getLocalMetadataPath(localPath: string): string {
    return `${localPath}.metadata.json`;
  }

  private async fetchStorage(
    url: string,
    init: RequestInit,
    action: string,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new InternalServerErrorException(
        `Could not ${action}. Evidence storage endpoint is unreachable.`,
      );
    }
  }

  private getAuthHeaders(
    config: SupabaseEvidenceStorageConfig,
  ): Record<string, string> {
    return {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    };
  }

  private async assertStorageResponse(
    response: Response,
    action: string,
  ): Promise<void> {
    if (response.ok) {
      return;
    }

    const body = await response.text();
    const detail = body ? ` ${body}` : '';

    throw new InternalServerErrorException(
      `Could not ${action}.${detail}`.trim(),
    );
  }

  private sanitizeFileName(fileName: string): string {
    const leafName = basename(fileName.trim().replace(/\\/g, '/'));
    const safeName = leafName
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);

    return safeName || 'evidence.bin';
  }

  private sanitizePathSegment(segment: string): string {
    return segment.replace(/[^a-zA-Z0-9_-]+/g, '-');
  }

  private isPlaceholderValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();

    return (
      normalized.includes('[project-ref]') ||
      normalized.includes('<') ||
      normalized.includes('>') ||
      normalized.includes('xxxx.supabase.co') ||
      normalized.startsWith('your_') ||
      normalized.startsWith('your-')
    );
  }

  private getBodySize(body: EvidenceBody): number {
    return body.byteLength;
  }

  private toFetchBody(body: EvidenceBody): ArrayBuffer {
    if (body instanceof ArrayBuffer) {
      return body;
    }

    const bodyView = new Uint8Array(
      body.buffer,
      body.byteOffset,
      body.byteLength,
    );
    const copy = new Uint8Array(body.byteLength);
    copy.set(bodyView);

    return copy.buffer;
  }
}
