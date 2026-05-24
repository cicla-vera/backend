import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UpdateSafetyProfileDto } from './dto/update-safety-profile.dto';
import { VeraService } from './vera.service';

@UseGuards(JwtGuard)
@Controller('vera')
export class VeraController {
  constructor(private readonly veraService: VeraService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: { sub: string }) {
    return this.veraService.getProfile(user.sub);
  }

  @Post('profile')
  createProfile(
    @CurrentUser() user: { sub: string },
    @Body() dto: UpdateSafetyProfileDto,
  ) {
    return this.veraService.saveProfile(user.sub, dto);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: { sub: string },
    @Body() dto: UpdateSafetyProfileDto,
  ) {
    return this.veraService.saveProfile(user.sub, dto);
  }
}
