import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AccountVerificationService } from './account-verification.service';
import { ConfirmAccountVerificationDto } from './dto/confirm-account-verification.dto';

@UseGuards(JwtGuard)
@Controller('account-verification')
export class AccountVerificationController {
  constructor(private verificationService: AccountVerificationService) {}

  @Get('status')
  getStatus(@CurrentUser() user: { sub: string }) {
    return this.verificationService.getStatus(user.sub);
  }

  @Post('email/request')
  requestEmail(@CurrentUser() user: { sub: string }) {
    return this.verificationService.requestEmailVerification(user.sub);
  }

  @Post('email/confirm')
  confirmEmail(
    @CurrentUser() user: { sub: string },
    @Body() dto: ConfirmAccountVerificationDto,
  ) {
    return this.verificationService.confirmEmailVerification(
      user.sub,
      dto.code,
    );
  }

  @Post('phone/request')
  requestPhone(@CurrentUser() user: { sub: string }) {
    return this.verificationService.requestPhoneVerification(user.sub);
  }

  @Post('phone/confirm')
  confirmPhone(
    @CurrentUser() user: { sub: string },
    @Body() dto: ConfirmAccountVerificationDto,
  ) {
    return this.verificationService.confirmPhoneVerification(
      user.sub,
      dto.code,
    );
  }
}
