import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountVerificationController } from './account-verification.controller';
import { AccountVerificationDeliveryService } from './account-verification-delivery.service';
import { AccountVerificationService } from './account-verification.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountVerificationController],
  providers: [AccountVerificationDeliveryService, AccountVerificationService],
  exports: [AccountVerificationService],
})
export class AccountVerificationModule {}
