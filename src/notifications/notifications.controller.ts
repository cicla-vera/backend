import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: { sub: string }) {
    return this.notificationsService.getSettings(user.sub);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: { sub: string },
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.notificationsService.updateSettings(user.sub, dto);
  }
}
