import { Injectable } from '@nestjs/common';
import { AccountVerificationChannel } from '@prisma/client';

type DeliverVerificationCodeInput = {
  channel: AccountVerificationChannel;
  destination: string;
  code: string;
  expiresAt: Date;
};

type DeliverVerificationCodeResult = {
  provider: string;
  devCode?: string;
};

@Injectable()
export class AccountVerificationDeliveryService {
  deliverVerificationCode(
    input: DeliverVerificationCodeInput,
  ): Promise<DeliverVerificationCodeResult> {
    const provider = this.getProvider();

    if (provider === 'mock') {
      return Promise.resolve({
        provider,
        devCode: input.code,
      });
    }

    return Promise.resolve({ provider });
  }

  getProvider() {
    const configuredProvider =
      process.env.ACCOUNT_VERIFICATION_PROVIDER?.trim();

    if (configuredProvider) {
      return configuredProvider;
    }

    return process.env.NODE_ENV === 'production' ? 'disabled' : 'mock';
  }

  isMockProvider() {
    return this.getProvider() === 'mock';
  }
}
