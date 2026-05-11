import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
import { SendDueRemindersDto } from './dto/send-due-reminders.dto';
import { SendTestNotificationDto } from './dto/send-test-notification.dto';
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

  @Post('devices')
  registerDevice(
    @CurrentUser() user: { sub: string },
    @Body() dto: RegisterNotificationDeviceDto,
  ) {
    return this.notificationsService.registerDevice(user.sub, dto);
  }

  @Get('devices')
  findDevices(@CurrentUser() user: { sub: string }) {
    return this.notificationsService.findDevices(user.sub);
  }

  @Delete('devices/:id')
  removeDevice(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.notificationsService.removeDevice(user.sub, id);
  }

  @Get('reminders/preview')
  previewReminders(@CurrentUser() user: { sub: string }) {
    return this.notificationsService.previewReminders(user.sub);
  }

  @Post('reminders/send-due')
  sendDueReminders(
    @CurrentUser() user: { sub: string },
    @Body() dto: SendDueRemindersDto,
  ) {
    return this.notificationsService.sendDueReminders(user.sub, dto);
  }

  @Post('test')
  sendTest(
    @CurrentUser() user: { sub: string },
    @Body() dto: SendTestNotificationDto,
  ) {
    return this.notificationsService.sendTest(user.sub, dto);
  }
}
