import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type SmsProviderName = 'mock' | 'twilio' | 'unconfigured';
type SmsDeliveryStatus = 'sent' | 'failed';

export type SendSmsInput = {
  to: string;
  body: string;
};

export type SendSmsResult = {
  provider: SmsProviderName;
  status: SmsDeliveryStatus;
  providerMessageId?: string;
  failureReason?: string;
};

type TwilioConfig = {
  accountSid: string;
  authToken: string;
  fromPhoneNumber: string;
};

type TwilioMessageResponse = {
  sid?: string;
};

const SMS_PROVIDER_ENV = 'EMERGENCY_SMS_PROVIDER';
const TWILIO_PROVIDER = 'twilio';
const MOCK_PROVIDER = 'mock';

@Injectable()
export class MessagingProviderService {
  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const provider = this.resolveProvider();

    if (provider === MOCK_PROVIDER) {
      return {
        provider,
        status: 'sent',
        providerMessageId: `mock-${randomUUID()}`,
      };
    }

    if (provider === TWILIO_PROVIDER) {
      return this.sendWithTwilio(input);
    }

    return {
      provider,
      status: 'failed',
      failureReason: 'sms_provider_not_configured',
    };
  }

  private async sendWithTwilio(input: SendSmsInput): Promise<SendSmsResult> {
    const config = this.getTwilioConfig();

    if (!config) {
      return {
        provider: TWILIO_PROVIDER,
        status: 'failed',
        failureReason: 'twilio_not_configured',
      };
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${config.accountSid}:${config.authToken}`,
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: input.to,
          From: config.fromPhoneNumber,
          Body: input.body,
        }),
      },
    );

    if (!response.ok) {
      return {
        provider: TWILIO_PROVIDER,
        status: 'failed',
        failureReason: `twilio_http_${response.status}`,
      };
    }

    const responseBody = await this.parseTwilioResponse(response);

    return {
      provider: TWILIO_PROVIDER,
      status: 'sent',
      providerMessageId: responseBody.sid,
    };
  }

  private resolveProvider(): SmsProviderName {
    const configuredProvider = process.env[SMS_PROVIDER_ENV]?.toLowerCase();

    if (configuredProvider === MOCK_PROVIDER) {
      return MOCK_PROVIDER;
    }

    if (configuredProvider === TWILIO_PROVIDER) {
      return TWILIO_PROVIDER;
    }

    if (this.getTwilioConfig()) {
      return TWILIO_PROVIDER;
    }

    if (process.env.NODE_ENV === 'production') {
      return 'unconfigured';
    }

    return MOCK_PROVIDER;
  }

  private getTwilioConfig(): TwilioConfig | null {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhoneNumber = process.env.TWILIO_FROM_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhoneNumber) {
      return null;
    }

    return { accountSid, authToken, fromPhoneNumber };
  }

  private async parseTwilioResponse(
    response: Response,
  ): Promise<TwilioMessageResponse> {
    const responseBody: unknown = await response.json().catch(() => null);

    if (
      responseBody &&
      typeof responseBody === 'object' &&
      'sid' in responseBody &&
      typeof responseBody.sid === 'string'
    ) {
      return { sid: responseBody.sid };
    }

    return {};
  }
}
