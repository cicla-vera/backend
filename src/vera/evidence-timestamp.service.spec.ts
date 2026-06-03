import { EvidenceTimestampService } from './evidence-timestamp.service';

describe('EvidenceTimestampService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VERA_EVIDENCE_TIMESTAMP_PROVIDER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates an explicit system-clock timestamp receipt by default', async () => {
    const service = new EvidenceTimestampService();

    const receipt = await service.createTimestampReceipt({
      digest: 'a'.repeat(64),
      hashAlgorithm: 'SHA-256',
      purpose: 'vera-evidence-export-manifest',
    });

    expect(receipt).toMatchObject({
      provider: 'system-clock',
      trustStatus: 'UNTRUSTED_SYSTEM_CLOCK',
      digest: 'a'.repeat(64),
      hashAlgorithm: 'SHA-256',
      purpose: 'vera-evidence-export-manifest',
      token: null,
      verificationUrl: null,
    });
    expect(receipt.issuedAt).toEqual(expect.any(String));
    expect(receipt.notes.join(' ')).toContain('RFC 3161');
  });

  it('marks configured external providers as pending adapter work', async () => {
    process.env.VERA_EVIDENCE_TIMESTAMP_PROVIDER = 'rfc3161-example';
    const service = new EvidenceTimestampService();

    const receipt = await service.createTimestampReceipt({
      digest: 'b'.repeat(64),
      hashAlgorithm: 'SHA-256',
      purpose: 'vera-evidence-export-manifest',
    });

    expect(receipt).toMatchObject({
      provider: 'rfc3161-example',
      trustStatus: 'PROVIDER_ADAPTER_PENDING',
      digest: 'b'.repeat(64),
    });
  });
});
