import { Injectable } from '@nestjs/common';

export type EvidenceTimestampTrustStatus =
  | 'UNTRUSTED_SYSTEM_CLOCK'
  | 'PROVIDER_ADAPTER_PENDING';

export type EvidenceTimestampReceipt = {
  provider: string;
  trustStatus: EvidenceTimestampTrustStatus;
  digest: string;
  hashAlgorithm: string;
  purpose: string;
  issuedAt: string;
  token: string | null;
  verificationUrl: string | null;
  notes: string[];
};

type EvidenceTimestampRequest = {
  digest: string;
  hashAlgorithm: string;
  purpose: string;
};

const DEFAULT_TIMESTAMP_PROVIDER = 'system-clock';

@Injectable()
export class EvidenceTimestampService {
  createTimestampReceipt(
    input: EvidenceTimestampRequest,
  ): Promise<EvidenceTimestampReceipt> {
    const configuredProvider =
      process.env.VERA_EVIDENCE_TIMESTAMP_PROVIDER?.trim();
    const provider = configuredProvider || DEFAULT_TIMESTAMP_PROVIDER;
    const isSystemClockProvider = provider === DEFAULT_TIMESTAMP_PROVIDER;

    return Promise.resolve({
      provider,
      trustStatus: isSystemClockProvider
        ? 'UNTRUSTED_SYSTEM_CLOCK'
        : 'PROVIDER_ADAPTER_PENDING',
      digest: input.digest,
      hashAlgorithm: input.hashAlgorithm,
      purpose: input.purpose,
      issuedAt: new Date().toISOString(),
      token: null,
      verificationUrl: null,
      notes: isSystemClockProvider
        ? [
            'Timestamp emitted by backend system clock only.',
            'Configure an RFC 3161 or equivalent trusted timestamp provider before claiming trusted external time.',
          ]
        : [
            'Timestamp provider selected, but the external adapter is not implemented yet.',
            'The manifest digest is ready to be submitted to an RFC 3161 or equivalent provider.',
          ],
    });
  }
}
