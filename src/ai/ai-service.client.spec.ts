import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiServiceClient } from './ai-service.client';

describe('AiServiceClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: AiServiceClient;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.useRealTimers();
    process.env = {
      ...originalEnv,
      AI_SERVICE_URL: 'http://localhost:8000/',
      AI_SERVICE_TIMEOUT_MS: '1000',
    };
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    client = new AiServiceClient();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('checks AI service health using the configured base URL and timeout', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );

    const result = await client.healthCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];

    if (!call) {
      throw new Error('Expected AI health fetch call');
    }

    const [url, init] = call;

    expect(url).toBe('http://localhost:8000/health');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      status: 'ok',
      available: true,
    });
  });

  it('posts evidence analysis requests and validates the response contract', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          riskLevel: 'critical',
          confidence: 0.94,
          summary: 'Possible immediate danger detected.',
          detectedSignals: ['threatening_language', 'impact_sound'],
          shouldEscalate: true,
        }),
        { status: 200 },
      ),
    );

    const result = await client.analyzeEvidence({
      evidenceRecordId: 'evidence-id',
      alertSessionId: 'session-id',
      evidenceType: 'AUDIO',
      mimeType: 'audio/wav',
      size: 512,
      contentHash: 'a'.repeat(64),
    });

    const call = fetchMock.mock.calls[0];

    if (!call) {
      throw new Error('Expected AI analyze fetch call');
    }

    const [url, init] = call;

    expect(url).toBe('http://localhost:8000/analyze');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    if (typeof init?.body !== 'string') {
      throw new Error('Expected JSON string request body');
    }

    expect(JSON.parse(init.body)).toEqual({
      evidenceRecordId: 'evidence-id',
      alertSessionId: 'session-id',
      evidenceType: 'AUDIO',
      mimeType: 'audio/wav',
      size: 512,
      contentHash: 'a'.repeat(64),
    });
    expect(result).toEqual({
      riskLevel: 'CRITICAL',
      confidence: 0.94,
      summary: 'Possible immediate danger detected.',
      detectedSignals: ['threatening_language', 'impact_sound'],
      shouldEscalate: true,
    });
  });

  it('fails with a controlled exception when AI service URL is missing', async () => {
    delete process.env.AI_SERVICE_URL;

    await expect(client.healthCheck()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates AI service HTTP errors into controlled exceptions', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }),
    );

    await expect(client.healthCheck()).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rejects invalid AI analysis responses', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          riskLevel: 'critical',
          confidence: '0.94',
          summary: 'Invalid payload',
          detectedSignals: [],
          shouldEscalate: true,
        }),
        { status: 200 },
      ),
    );

    await expect(
      client.analyzeEvidence({
        evidenceRecordId: 'evidence-id',
        alertSessionId: 'session-id',
        evidenceType: 'AUDIO',
        mimeType: 'audio/wav',
        size: 512,
        contentHash: 'a'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('times out slow AI service requests', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const request = client.healthCheck();
    const expectation = expect(request).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    await jest.advanceTimersByTimeAsync(1000);

    await expectation;
  });
});
