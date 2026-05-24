import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { SetVeraPinDto } from './dto/set-vera-pin.dto';
import { VerifyVeraPinDto } from './dto/verify-vera-pin.dto';
import { VeraPinService } from './vera-pin.service';

@UseGuards(JwtGuard)
@Controller('vera/pin')
export class VeraPinController {
  constructor(private readonly veraPinService: VeraPinService) {}

  @Post()
  setPin(@CurrentUser() user: { sub: string }, @Body() dto: SetVeraPinDto) {
    return this.veraPinService.setPin(user.sub, dto);
  }

  @Post('verify')
  verifyPin(
    @CurrentUser() user: { sub: string },
    @Body() dto: VerifyVeraPinDto,
  ) {
    return this.veraPinService.verifyPin(user.sub, dto);
  }
}
