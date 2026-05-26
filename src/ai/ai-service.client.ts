import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

type AiClientConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type AiHealthResponse = {
  status: string;
  available: boolean;
};

export type AnalyzeEvidenceInput = {
  evidenceRecordId: string;
  alertSessionId: string;
  evidenceType: string;
  mimeType: string;
  size: number;
  contentHash: string;
};

export type AnalyzeEvidenceResponse = {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  confidence: number;
  summary: string;
  detectedSignals: string[];
  shouldEscalate: boolean;
};

type RequestOptions = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
};

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30000;
const VALID_RISK_LEVELS = new Set([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
  'UNKNOWN',
]);

@Injectable()
export class AiServiceClient {
  async healthCheck(): Promise<AiHealthResponse> {
    const response = await this.request({
      method: 'GET',
      path: '/health',
    });
    const status = this.getOptionalString(response, 'status') ?? 'unknown';

    return {
      status,
      available: true,
    };
  }

  async analyzeEvidence(
    input: AnalyzeEvidenceInput,
  ): Promise<AnalyzeEvidenceResponse> {
    const response = await this.request({
      method: 'POST',
      path: '/analyze',
      body: input,
    });

    return this.parseAnalyzeResponse(response);
  }

  private async request(
    options: RequestOptions,
  ): Promise<Record<string, unknown>> {
    const config = this.getConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(
        this.buildUrl(config.baseUrl, options.path),
        {
          method: options.method,
          headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new BadGatewayException(
          `AI service responded with status ${response.status}.`,
        );
      }

      return await this.parseJsonObject(response);
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      if (this.isAbortError(error)) {
        throw new GatewayTimeoutException('AI service request timed out.');
      }

      throw new BadGatewayException('AI service request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private getConfig(): AiClientConfig {
    const baseUrl = process.env.AI_SERVICE_URL?.replace(/\/+$/, '');
    const timeoutMs = this.parseTimeout(process.env.AI_SERVICE_TIMEOUT_MS);

    if (!baseUrl) {
      throw new ServiceUnavailableException('AI service is not configured.');
    }

    return { baseUrl, timeoutMs };
  }

  private parseTimeout(value?: string): number {
    if (!value) {
      return DEFAULT_TIMEOUT_MS;
    }

    const timeoutMs = Number(value);

    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      return DEFAULT_TIMEOUT_MS;
    }

    return timeoutMs;
  }

  private buildUrl(baseUrl: string, path: string): string {
    return `${baseUrl}${path}`;
  }

  private async parseJsonObject(
    response: Response,
  ): Promise<Record<string, unknown>> {
    const body: unknown = await response.json().catch(() => null);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadGatewayException('AI service returned an invalid response.');
    }

    return body as Record<string, unknown>;
  }

  private parseAnalyzeResponse(
    response: Record<string, unknown>,
  ): AnalyzeEvidenceResponse {
    const riskLevel = this.getRiskLevel(response);
    const confidence = this.getNumber(response, 'confidence');
    const summary = this.getString(response, 'summary');
    const detectedSignals = this.getStringArray(response, 'detectedSignals');
    const shouldEscalate = this.getBoolean(response, 'shouldEscalate');

    return {
      riskLevel,
      confidence,
      summary,
      detectedSignals,
      shouldEscalate,
    };
  }

  private getRiskLevel(
    response: Record<string, unknown>,
  ): AnalyzeEvidenceResponse['riskLevel'] {
    const riskLevel = this.getString(response, 'riskLevel').toUpperCase();

    if (!VALID_RISK_LEVELS.has(riskLevel)) {
      throw new BadGatewayException(
        'AI service returned an invalid analysis response.',
      );
    }

    return riskLevel as AnalyzeEvidenceResponse['riskLevel'];
  }

  private getString(response: Record<string, unknown>, key: string): string {
    const value = response[key];

    if (typeof value !== 'string') {
      throw new BadGatewayException(
        'AI service returned an invalid analysis response.',
      );
    }

    return value;
  }

  private getOptionalString(
    response: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = response[key];
    return typeof value === 'string' ? value : undefined;
  }

  private getNumber(response: Record<string, unknown>, key: string): number {
    const value = response[key];

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadGatewayException(
        'AI service returned an invalid analysis response.',
      );
    }

    return value;
  }

  private getBoolean(response: Record<string, unknown>, key: string): boolean {
    const value = response[key];

    if (typeof value !== 'boolean') {
      throw new BadGatewayException(
        'AI service returned an invalid analysis response.',
      );
    }

    return value;
  }

  private getStringArray(
    response: Record<string, unknown>,
    key: string,
  ): string[] {
    const value = response[key];

    if (!Array.isArray(value)) {
      throw new BadGatewayException(
        'AI service returned an invalid analysis response.',
      );
    }

    const items = value as unknown[];
    const strings: string[] = [];

    for (const item of items) {
      if (typeof item !== 'string') {
        throw new BadGatewayException(
          'AI service returned an invalid analysis response.',
        );
      }

      strings.push(item);
    }

    return strings;
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('name' in error)) {
      return false;
    }

    const errorName = (error as { name?: unknown }).name;
    return errorName === 'AbortError';
  }
}
