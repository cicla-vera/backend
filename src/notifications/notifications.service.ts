import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { NotificationDevice } from '@prisma/client';
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

type ExpoPushTicket = {
  id?: string;
  status?: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
  };
};

type ExpoPushResponse = {
  data?: ExpoPushTicket[] | ExpoPushTicket;
  errors?: unknown[];
};

type PushSendResult = {
  disabledDeviceCount: number;
  failed: number;
  failureReason?: string;
  response: unknown;
  sent: number;
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
      body: dto.body ?? 'Notificacoes do Cicla Vera estao funcionando.',
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
        reason: 'O horario do lembrete ainda nao chegou.',
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
          reason: 'Lembrete ja enviado nesta data.',
        });
        continue;
      }

      const sendResult = await this.sendPushToUser(userId, reminder);

      if (sendResult.sent === 0) {
        results.push({
          type: reminder.type,
          status: 'skipped',
          reason:
            sendResult.failureReason ??
            'Nenhum dispositivo habilitado recebeu a notificacao.',
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
        title: 'Lembrete do ciclo',
        body: 'Sua próxima menstruação está prevista para hoje.',
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
        title: 'Janela fértil',
        body: 'Sua ovulação está prevista para hoje.',
        data: { type: 'OVULATION_REMINDER' },
      });
    }

    if (settings.medicationReminder) {
      reminders.push({
        type: 'MEDICATION_REMINDER',
        title: 'Lembrete de medicamento',
        body: 'Hora de conferir seus medicamentos de hoje.',
        data: { type: 'MEDICATION_REMINDER' },
      });
    }

    if (settings.waterReminder) {
      reminders.push({
        type: 'WATER_REMINDER',
        title: 'Hidratação',
        body: 'Beba água e cuide do seu corpo hoje.',
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
  ): Promise<PushSendResult> {
    const devices = await this.prisma.notificationDevice.findMany({
      where: { userId, enabled: true },
    });

    if (devices.length === 0) {
      return {
        disabledDeviceCount: 0,
        failed: 0,
        failureReason: 'Nenhum dispositivo habilitado cadastrado.',
        response: null,
        sent: 0,
      };
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

    const responseBody = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new BadRequestException({
        message: 'Expo push request failed.',
        response: responseBody,
      });
    }

    const tickets = this.getExpoPushTickets(responseBody, devices.length);
    const disabledDeviceIds = this.getDeviceIdsToDisable(devices, tickets);

    if (disabledDeviceIds.length > 0) {
      await this.prisma.notificationDevice.updateMany({
        where: {
          id: { in: disabledDeviceIds },
          userId,
        },
        data: {
          enabled: false,
        },
      });
    }

    const sent = tickets.filter((ticket) => ticket.status === 'ok').length;
    const failed = tickets.length - sent;
    const failureReason =
      sent === 0 && failed > 0
        ? 'A Expo Push API recusou todos os dispositivos habilitados.'
        : undefined;

    return {
      disabledDeviceCount: disabledDeviceIds.length,
      failed,
      failureReason,
      response: responseBody,
      sent,
    };
  }

  private getExpoPushTickets(
    responseBody: unknown,
    expectedCount: number,
  ): ExpoPushTicket[] {
    const body = this.asExpoPushResponse(responseBody);
    const data = Array.isArray(body?.data)
      ? body.data
      : body?.data
        ? [body.data]
        : [];

    if (data.length === 0 && body?.errors?.length) {
      throw new BadRequestException({
        message: 'Expo push returned request errors.',
        response: responseBody,
      });
    }

    if (data.length !== expectedCount) {
      throw new BadRequestException({
        message: 'Expo push returned an unexpected ticket count.',
        response: responseBody,
      });
    }

    return data.map((ticket) => ({
      details:
        ticket.details && typeof ticket.details === 'object'
          ? { error: this.getString(ticket.details.error) }
          : undefined,
      id: this.getString(ticket.id),
      message: this.getString(ticket.message),
      status: ticket.status === 'ok' ? 'ok' : 'error',
    }));
  }

  private getDeviceIdsToDisable(
    devices: NotificationDevice[],
    tickets: ExpoPushTicket[],
  ): string[] {
    return tickets
      .map((ticket, index) =>
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
          ? devices[index]?.id
          : null,
      )
      .filter((id): id is string => typeof id === 'string');
  }

  private asExpoPushResponse(value: unknown): ExpoPushResponse | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value;
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
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
