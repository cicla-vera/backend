import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AlertEventsService } from './alert-events.service';
import { CreateAlertEventDto } from './dto/create-alert-event.dto';

@UseGuards(JwtGuard)
@Controller('vera/alert-sessions/:alertSessionId/events')
export class AlertEventsController {
  constructor(private readonly alertEventsService: AlertEventsService) {}

  @Get()
  findTimeline(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
  ) {
    return this.alertEventsService.findTimeline(user.sub, alertSessionId);
  }

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Param('alertSessionId') alertSessionId: string,
    @Body() dto: CreateAlertEventDto,
  ) {
    return this.alertEventsService.create(user.sub, alertSessionId, dto);
  }
}
