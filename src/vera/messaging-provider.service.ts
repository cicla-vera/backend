import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type SmsProviderName = 'mock' | 'twilio' | 'unconfigured';
type SmsDeliveryStatus = 'sent' | 'failed';
export type EmergencyDeliveryChannel = 'sms' | 'whatsapp';

export type SendSmsInput = {
  to: string;
  body: string;
};

export type SendMessageInput = SendSmsInput & {
  channel: EmergencyDeliveryChannel;
};

export type SendSmsResult = {
  provider: SmsProviderName;
  status: SmsDeliveryStatus;
  providerMessageId?: string;
  failureReason?: string;
};

export type SendMessageResult = SendSmsResult & {
  channel: EmergencyDeliveryChannel;
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
const WHATSAPP_PROVIDER_ENV = 'EMERGENCY_WHATSAPP_PROVIDER';
const DISPATCH_CHANNELS_ENV = 'EMERGENCY_DISPATCH_CHANNELS';
const TWILIO_PROVIDER = 'twilio';
const MOCK_PROVIDER = 'mock';
const DEFAULT_DISPATCH_CHANNELS: EmergencyDeliveryChannel[] = ['sms'];

@Injectable()
export class MessagingProviderService {
  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const result = await this.sendMessage({
      ...input,
      channel: 'sms',
    });

    return {
      failureReason: result.failureReason,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      status: result.status,
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const provider = this.resolveProvider(input.channel);

    if (provider === MOCK_PROVIDER) {
      return {
        channel: input.channel,
        provider,
        status: 'sent',
        providerMessageId: `mock-${input.channel}-${randomUUID()}`,
      };
    }

    if (provider === TWILIO_PROVIDER) {
      return this.sendWithTwilio(input);
    }

    return {
      channel: input.channel,
      provider,
      status: 'failed',
      failureReason: `${input.channel}_provider_not_configured`,
    };
  }

  getEmergencyDispatchChannels(): EmergencyDeliveryChannel[] {
    const configuredChannels = process.env[DISPATCH_CHANNELS_ENV]?.split(',')
      .map((channel) => channel.trim().toLowerCase())
      .filter(Boolean);
    const channels = configuredChannels?.length
      ? configuredChannels
      : DEFAULT_DISPATCH_CHANNELS;
    const normalizedChannels = channels.filter(
      (channel): channel is EmergencyDeliveryChannel =>
        channel === 'sms' || channel === 'whatsapp',
    );

    return normalizedChannels.length
      ? [...new Set(normalizedChannels)]
      : DEFAULT_DISPATCH_CHANNELS;
  }

  private async sendWithTwilio(
    input: SendMessageInput,
  ): Promise<SendMessageResult> {
    const config = this.getTwilioConfig(input.channel);

    if (!config) {
      return {
        channel: input.channel,
        provider: TWILIO_PROVIDER,
        status: 'failed',
        failureReason:
          input.channel === 'sms'
            ? 'twilio_not_configured'
            : 'twilio_whatsapp_not_configured',
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
          To: this.formatTwilioAddress(input.channel, input.to),
          From: this.formatTwilioAddress(input.channel, config.fromPhoneNumber),
          Body: input.body,
        }),
      },
    );

    if (!response.ok) {
      return {
        channel: input.channel,
        provider: TWILIO_PROVIDER,
        status: 'failed',
        failureReason: `twilio_http_${response.status}`,
      };
    }

    const responseBody = await this.parseTwilioResponse(response);

    return {
      channel: input.channel,
      provider: TWILIO_PROVIDER,
      status: 'sent',
      providerMessageId: responseBody.sid,
    };
  }

  private resolveProvider(channel: EmergencyDeliveryChannel): SmsProviderName {
    const configuredProvider =
      process.env[
        channel === 'sms' ? SMS_PROVIDER_ENV : WHATSAPP_PROVIDER_ENV
      ]?.toLowerCase();

    if (configuredProvider === MOCK_PROVIDER) {
      return MOCK_PROVIDER;
    }

    if (configuredProvider === TWILIO_PROVIDER) {
      return TWILIO_PROVIDER;
    }

    if (this.getTwilioConfig(channel)) {
      return TWILIO_PROVIDER;
    }

    if (process.env.NODE_ENV === 'production') {
      return 'unconfigured';
    }

    return MOCK_PROVIDER;
  }

  private getTwilioConfig(
    channel: EmergencyDeliveryChannel,
  ): TwilioConfig | null {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhoneNumber =
      channel === 'sms'
        ? process.env.TWILIO_FROM_PHONE_NUMBER
        : process.env.TWILIO_WHATSAPP_FROM_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhoneNumber) {
      return null;
    }

    return { accountSid, authToken, fromPhoneNumber };
  }

  private formatTwilioAddress(
    channel: EmergencyDeliveryChannel,
    phoneNumber: string,
  ) {
    if (channel !== 'whatsapp') {
      return phoneNumber;
    }

    return phoneNumber.startsWith('whatsapp:')
      ? phoneNumber
      : `whatsapp:${phoneNumber}`;
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
