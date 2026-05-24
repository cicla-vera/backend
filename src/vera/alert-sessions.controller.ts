import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AlertSessionsService } from './alert-sessions.service';
import { CloseAlertSessionDto } from './dto/close-alert-session.dto';
import { StartLocationAlertSessionDto } from './dto/start-location-alert-session.dto';
import { StartManualAlertSessionDto } from './dto/start-manual-alert-session.dto';

@UseGuards(JwtGuard)
@Controller('vera/alert-sessions')
export class AlertSessionsController {
  constructor(private readonly alertSessionsService: AlertSessionsService) {}

  @Post('manual')
  startManual(
    @CurrentUser() user: { sub: string },
    @Body() dto: StartManualAlertSessionDto,
  ) {
    return this.alertSessionsService.startManual(user.sub, dto);
  }

  @Post('location')
  startLocation(
    @CurrentUser() user: { sub: string },
    @Body() dto: StartLocationAlertSessionDto,
  ) {
    return this.alertSessionsService.startLocation(user.sub, dto);
  }

  @Get('active')
  findActive(@CurrentUser() user: { sub: string }) {
    return this.alertSessionsService.findActive(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.alertSessionsService.findOne(user.sub, id);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: { sub: string },
    @Param('id') id: string,
    @Body() dto: CloseAlertSessionDto,
  ) {
    return this.alertSessionsService.close(user.sub, id, dto);
  }
}
