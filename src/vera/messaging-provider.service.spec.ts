import { MessagingProviderService } from './messaging-provider.service';

describe('MessagingProviderService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MessagingProviderService;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
    };
    delete process.env.EMERGENCY_SMS_PROVIDER;
    delete process.env.EMERGENCY_WHATSAPP_PROVIDER;
    delete process.env.EMERGENCY_DISPATCH_CHANNELS;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_PHONE_NUMBER;
    delete process.env.TWILIO_WHATSAPP_FROM_PHONE_NUMBER;
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    service = new MessagingProviderService();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('uses the mock provider by default in test and does not call external services', async () => {
    const result = await service.sendSms({
      to: '+5585999999999',
      body: 'Emergency message',
    });

    expect(result.provider).toBe('mock');
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toMatch(/^mock-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safely when Twilio is selected without full credentials', async () => {
    process.env.EMERGENCY_SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';

    const result = await service.sendSms({
      to: '+5585999999999',
      body: 'Emergency message',
    });

    expect(result).toEqual({
      provider: 'twilio',
      status: 'failed',
      failureReason: 'twilio_not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses configured emergency dispatch channels with SMS as default', () => {
    expect(service.getEmergencyDispatchChannels()).toEqual(['sms']);

    process.env.EMERGENCY_DISPATCH_CHANNELS = 'sms, whatsapp, sms,unknown';

    expect(service.getEmergencyDispatchChannels()).toEqual(['sms', 'whatsapp']);
  });

  it('sends through Twilio when credentials are configured', async () => {
    process.env.EMERGENCY_SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    process.env.TWILIO_FROM_PHONE_NUMBER = '+15550000000';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }),
    );

    const result = await service.sendSms({
      to: '+5585999999999',
      body: 'Emergency message',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0];

    if (!firstCall) {
      throw new Error('Expected Twilio fetch call');
    }

    const [url, init] = firstCall;

    expect(url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('AC123:secret-token').toString(
        'base64',
      )}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(init?.body).toBeInstanceOf(URLSearchParams);

    const body = init?.body as URLSearchParams;

    expect(body.get('To')).toBe('+5585999999999');
    expect(body.get('From')).toBe('+15550000000');
    expect(body.get('Body')).toBe('Emergency message');
    expect(result).toEqual({
      provider: 'twilio',
      status: 'sent',
      providerMessageId: 'SM123',
    });
  });

  it('sends WhatsApp through Twilio with channel-prefixed addresses', async () => {
    process.env.EMERGENCY_WHATSAPP_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    process.env.TWILIO_WHATSAPP_FROM_PHONE_NUMBER = '+14155238886';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SMWHATSAPP123' }), { status: 201 }),
    );

    const result = await service.sendMessage({
      channel: 'whatsapp',
      to: '+5585999999999',
      body: 'Emergency message',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0];

    if (!firstCall) {
      throw new Error('Expected Twilio fetch call');
    }

    const [, init] = firstCall;
    const body = init?.body as URLSearchParams;

    expect(body.get('To')).toBe('whatsapp:+5585999999999');
    expect(body.get('From')).toBe('whatsapp:+14155238886');
    expect(body.get('Body')).toBe('Emergency message');
    expect(result).toEqual({
      channel: 'whatsapp',
      provider: 'twilio',
      status: 'sent',
      providerMessageId: 'SMWHATSAPP123',
    });
  });

  it('fails WhatsApp safely when Twilio WhatsApp sender is missing', async () => {
    process.env.EMERGENCY_WHATSAPP_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';

    const result = await service.sendMessage({
      channel: 'whatsapp',
      to: '+5585999999999',
      body: 'Emergency message',
    });

    expect(result).toEqual({
      channel: 'whatsapp',
      provider: 'twilio',
      status: 'failed',
      failureReason: 'twilio_whatsapp_not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose Twilio credentials when Twilio returns an error', async () => {
    process.env.EMERGENCY_SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret-token';
    process.env.TWILIO_FROM_PHONE_NUMBER = '+15550000000';
    fetchMock.mockResolvedValue(new Response('auth failed', { status: 401 }));

    const result = await service.sendSms({
      to: '+5585999999999',
      body: 'Emergency message',
    });

    expect(result).toEqual({
      provider: 'twilio',
      status: 'failed',
      failureReason: 'twilio_http_401',
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});
