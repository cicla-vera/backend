import { InternalServerErrorException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStorageService } from './evidence-storage.service';

describe('EvidenceStorageService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: EvidenceStorageService;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let localStorageDir: string | null;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co/',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_STORAGE_BUCKET: 'vera-evidence',
    };
    delete process.env.VERA_EVIDENCE_STORAGE_DRIVER;
    delete process.env.VERA_EVIDENCE_LOCAL_STORAGE_DIR;
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    service = new EvidenceStorageService();
    localStorageDir = null;
  });

  afterEach(async () => {
    if (localStorageDir) {
      await rm(localStorageDir, { force: true, recursive: true });
    }

    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('builds evidence paths isolated by user and alert session', () => {
    const path = service.buildEvidencePath({
      userId: 'user/id',
      alertSessionId: 'session:id',
      fileName: '../unsafe áudio.mp3',
    });

    expect(path).toMatch(
      /^users\/user-id\/alert-sessions\/session-id\/.+-unsafe-udio.mp3$/,
    );
  });

  it('uploads evidence to a private Supabase Storage bucket', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const result = await service.uploadEvidence({
      userId: 'user-id',
      alertSessionId: 'session-id',
      fileName: 'audio.wav',
      contentType: 'audio/wav',
      body: Buffer.from('audio-bytes'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toMatch(
      /^https:\/\/example.supabase.co\/storage\/v1\/object\/vera-evidence\/users\/user-id\/alert-sessions\/session-id\/.+-audio.wav$/,
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        apikey: 'service-role-key',
        Authorization: 'Bearer service-role-key',
        'Content-Type': 'audio/wav',
        'x-upsert': 'false',
      },
    });
    expect(result.bucket).toBe('vera-evidence');
    expect(result.path).toContain('users/user-id/alert-sessions/session-id');
    expect(result.size).toBe(Buffer.byteLength('audio-bytes'));
  });

  it('downloads evidence through the internal storage client', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('audio-bytes'), {
        status: 200,
        headers: {
          'content-type': 'audio/wav',
          'content-length': String(Buffer.byteLength('audio-bytes')),
        },
      }),
    );

    const result = await service.downloadEvidence(
      'users/user-id/alert-sessions/session-id/audio.wav',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/storage/v1/object/vera-evidence/users/user-id/alert-sessions/session-id/audio.wav',
      {
        method: 'GET',
        headers: {
          apikey: 'service-role-key',
          Authorization: 'Bearer service-role-key',
        },
      },
    );
    expect(result.contentType).toBe('audio/wav');
    expect(result.size).toBe(Buffer.byteLength('audio-bytes'));
    expect(result.body.byteLength).toBe(Buffer.byteLength('audio-bytes'));
  });

  it('stores and downloads evidence from the local driver for dev smoke tests', async () => {
    localStorageDir = await mkdtemp(join(tmpdir(), 'vera-evidence-'));
    process.env.VERA_EVIDENCE_STORAGE_DRIVER = 'local';
    process.env.VERA_EVIDENCE_LOCAL_STORAGE_DIR = localStorageDir;

    const uploaded = await service.uploadEvidence({
      userId: 'user-id',
      alertSessionId: 'session-id',
      fileName: 'audio.wav',
      contentType: 'audio/wav',
      body: Buffer.from('audio-bytes'),
    });

    const stored = await readFile(join(localStorageDir, uploaded.path));
    const downloaded = await service.downloadEvidence(uploaded.path);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored.toString('utf8')).toBe('audio-bytes');
    expect(downloaded.contentType).toBe('audio/wav');
    expect(Buffer.from(downloaded.body).toString('utf8')).toBe('audio-bytes');
  });

  it('fails without storage credentials', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(
      service.uploadEvidence({
        userId: 'user-id',
        alertSessionId: 'session-id',
        fileName: 'audio.wav',
        contentType: 'audio/wav',
        body: Buffer.from('audio-bytes'),
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats placeholder storage values as unconfigured', async () => {
    process.env.SUPABASE_URL = 'https://xxxx.supabase.co/';

    await expect(
      service.uploadEvidence({
        userId: 'user-id',
        alertSessionId: 'session-id',
        fileName: 'audio.wav',
        contentType: 'audio/wav',
        body: Buffer.from('audio-bytes'),
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps failed Supabase responses', async () => {
    fetchMock.mockResolvedValue(
      new Response('bucket not found', { status: 404 }),
    );

    await expect(
      service.uploadEvidence({
        userId: 'user-id',
        alertSessionId: 'session-id',
        fileName: 'audio.wav',
        contentType: 'audio/wav',
        body: Buffer.from('audio-bytes'),
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps unreachable storage endpoints without leaking raw fetch errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      service.uploadEvidence({
        userId: 'user-id',
        alertSessionId: 'session-id',
        fileName: 'audio.wav',
        contentType: 'audio/wav',
        body: Buffer.from('audio-bytes'),
      }),
    ).rejects.toMatchObject({
      message:
        'Could not upload evidence. Evidence storage endpoint is unreachable.',
    });
  });
});
