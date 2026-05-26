import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterNotificationDeviceDto } from './dto/register-notification-device.dto';
import { SendDueRemindersDto } from './dto/send-due-reminders.dto';
import { SendTestNotificationDto } from './dto/send-test-notification.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const DAY_IN_MS = 1000 * 60 * 60 * 24;

type ReminderType =
  | 'PERIOD_REMINDER'
  | 'OVULATION_REMINDER'
  | 'MEDICATION_REMINDER'
  | 'WATER_REMINDER';

type ReminderPayload = {
  type: ReminderType;
  title: string;
  body: string;
  data: Record<string, string>;
};

type ExpoPushMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data?: Record<string, string>;
};

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

  async registerDevice(userId: string, dto: RegisterNotificationDeviceDto) {
    if (!this.isExpoPushToken(dto.token)) {
      throw new BadRequestException('Invalid Expo push token.');
    }

    return this.prisma.notificationDevice.upsert({
      where: { token: dto.token },
      update: {
        userId,
        platform: dto.platform,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
      },
    });
  }

  async findDevices(userId: string) {
    return this.prisma.notificationDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async removeDevice(userId: string, id: string) {
    const result = await this.prisma.notificationDevice.deleteMany({
      where: { id, userId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Notification device not found');
    }

    return result;
  }

  async previewReminders(userId: string) {
    const referenceDate = new Date();
    const { reminders, settings } = await this.buildReminders(
      userId,
      referenceDate,
    );

    return {
      referenceDate: this.formatDate(referenceDate),
      reminderHour: settings.reminderHour,
      isDueNow: this.isReminderWindowOpen(referenceDate, settings.reminderHour),
      reminders,
    };
  }

  async sendTest(userId: string, dto: SendTestNotificationDto) {
    return this.sendPushToUser(userId, {
      title: dto.title ?? 'Cicla Vera',
      body: dto.body ?? 'Push notifications are working.',
      data: { type: 'TEST_NOTIFICATION' },
    });
  }

  async sendDueReminders(userId: string, dto: SendDueRemindersDto) {
    const referenceDate = dto.referenceDate
      ? new Date(dto.referenceDate)
      : new Date();

    if (Number.isNaN(referenceDate.getTime())) {
      throw new BadRequestException('Invalid referenceDate.');
    }

    const { reminders, settings } = await this.buildReminders(
      userId,
      referenceDate,
    );

    if (!this.isReminderWindowOpen(referenceDate, settings.reminderHour)) {
      return {
        sent: 0,
        skipped: reminders.length,
        reason: 'Reminder hour has not been reached yet.',
        reminders,
      };
    }

    const referenceDay = this.startOfDay(referenceDate);
    const results: Array<{
      type: ReminderType;
      status: 'sent' | 'skipped';
      reason?: string;
    }> = [];

    for (const reminder of reminders) {
      const alreadySent = await this.prisma.notificationDelivery.findUnique({
        where: {
          userId_type_referenceDate: {
            userId,
            type: reminder.type,
            referenceDate: referenceDay,
          },
        },
      });

      if (alreadySent) {
        results.push({
          type: reminder.type,
          status: 'skipped',
          reason: 'Already sent for this date.',
        });
        continue;
      }

      const sendResult = await this.sendPushToUser(userId, reminder);

      if (sendResult.sent === 0) {
        results.push({
          type: reminder.type,
          status: 'skipped',
          reason: 'No enabled devices registered.',
        });
        continue;
      }

      await this.prisma.notificationDelivery.create({
        data: {
          userId,
          type: reminder.type,
          referenceDate: referenceDay,
          title: reminder.title,
          body: reminder.body,
        },
      });

      results.push({ type: reminder.type, status: 'sent' });
    }

    return {
      sent: results.filter((result) => result.status === 'sent').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      results,
    };
  }

  private async buildReminders(userId: string, referenceDate: Date) {
    const settings = await this.getSettings(userId);
    const reminders: ReminderPayload[] = [];
    const prediction = await this.getCyclePrediction(userId, referenceDate);

    if (
      settings.periodReminder &&
      prediction?.nextPeriodDate &&
      this.isSameDay(prediction.nextPeriodDate, referenceDate)
    ) {
      reminders.push({
        type: 'PERIOD_REMINDER',
        title: 'Period reminder',
        body: 'Your next period is expected today.',
        data: { type: 'PERIOD_REMINDER' },
      });
    }

    if (
      settings.ovulationReminder &&
      prediction?.ovulationDate &&
      this.isSameDay(prediction.ovulationDate, referenceDate)
    ) {
      reminders.push({
        type: 'OVULATION_REMINDER',
        title: 'Ovulation reminder',
        body: 'Your ovulation is expected today.',
        data: { type: 'OVULATION_REMINDER' },
      });
    }

    if (settings.medicationReminder) {
      reminders.push({
        type: 'MEDICATION_REMINDER',
        title: 'Medication reminder',
        body: 'Remember to take your medication.',
        data: { type: 'MEDICATION_REMINDER' },
      });
    }

    if (settings.waterReminder) {
      reminders.push({
        type: 'WATER_REMINDER',
        title: 'Water reminder',
        body: 'Remember to drink water today.',
        data: { type: 'WATER_REMINDER' },
      });
    }

    return { settings, reminders };
  }

  private async getCyclePrediction(userId: string, referenceDate: Date) {
    const cycles = await this.prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { startDate: 'asc' },
      take: 12,
    });

    if (cycles.length === 0) {
      return null;
    }

    const cycleLengths: number[] = [];
    for (let index = 0; index < cycles.length - 1; index += 1) {
      cycleLengths.push(
        this.calculateDayDifference(
          cycles[index].startDate,
          cycles[index + 1].startDate,
        ),
      );
    }

    const averageCycleLength =
      cycleLengths.length > 0
        ? Math.round(
            cycleLengths.reduce((sum, value) => sum + value, 0) /
              cycleLengths.length,
          )
        : 28;

    const lastCycle = cycles[cycles.length - 1];
    const nextPeriodDate = new Date(lastCycle.startDate);
    nextPeriodDate.setDate(nextPeriodDate.getDate() + averageCycleLength);

    for (
      let index = 0;
      nextPeriodDate < referenceDate && index < 24;
      index += 1
    ) {
      nextPeriodDate.setDate(nextPeriodDate.getDate() + averageCycleLength);
    }

    const ovulationDate = new Date(nextPeriodDate);
    ovulationDate.setDate(ovulationDate.getDate() - 14);

    return { nextPeriodDate, ovulationDate, averageCycleLength };
  }

  private async sendPushToUser(
    userId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, string>;
    },
  ) {
    const devices = await this.prisma.notificationDevice.findMany({
      where: { userId, enabled: true },
    });

    if (devices.length === 0) {
      return { sent: 0, response: null };
    }

    const messages: ExpoPushMessage[] = devices.map((device) => ({
      to: device.token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: notification.data,
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const responseBody = (await response.json()) as unknown;

    if (!response.ok) {
      throw new BadRequestException({
        message: 'Expo push request failed.',
        response: responseBody,
      });
    }

    return {
      sent: devices.length,
      response: responseBody,
    };
  }

  private isExpoPushToken(token: string) {
    return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+]$/.test(token);
  }

  private calculateDayDifference(startDate: Date, endDate: Date) {
    return Math.round((endDate.getTime() - startDate.getTime()) / DAY_IN_MS);
  }

  private isReminderWindowOpen(referenceDate: Date, reminderHour: number) {
    return referenceDate.getHours() >= reminderHour;
  }

  private isSameDay(left: Date, right: Date) {
    return this.formatDate(left) === this.formatDate(right);
  }

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private formatDate(date: Date) {
    return date.toISOString().split('T')[0];
  }
}
