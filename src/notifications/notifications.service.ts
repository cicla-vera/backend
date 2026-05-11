import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async getSettings(userId: string) {
    return this.prisma.notificationSettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async updateSettings(userId: string, dto: UpdateNotificationSettingsDto) {
    return this.prisma.notificationSettings.upsert({
      where: { userId },
      update: {
        periodReminder: dto.periodReminder,
        ovulationReminder: dto.ovulationReminder,
        medicationReminder: dto.medicationReminder,
        waterReminder: dto.waterReminder,
        reminderHour: dto.reminderHour,
      },
      create: {
        userId,
        periodReminder: dto.periodReminder,
        ovulationReminder: dto.ovulationReminder,
        medicationReminder: dto.medicationReminder,
        waterReminder: dto.waterReminder,
        reminderHour: dto.reminderHour,
      },
    });
  }
}
