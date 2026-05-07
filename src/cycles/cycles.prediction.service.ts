import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CyclesPredictionService {
  constructor(private prisma: PrismaService) {}

  async predict(userId: string) {
    const cycles = await this.prisma.cycleLog.findMany({
      where: { userId, endDate: { not: null } },
      orderBy: { startDate: 'desc' },
      take: 6,
    });

    if (cycles.length === 0) {
      return {
        nextPeriod: null,
        ovulationDate: null,
        fertileWindow: null,
        message: 'Not enough data to predict. Log at least one complete cycle.',
      };
    }

    const durations = cycles
      .filter((c) => c.duration !== null)
      .map((c) => c.duration as number);

    const averageCycleLength =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 28;

    const lastCycle = cycles[0];
    const lastStartDate = new Date(lastCycle.startDate);

    const nextPeriodDate = new Date(lastStartDate);
    nextPeriodDate.setDate(nextPeriodDate.getDate() + averageCycleLength);

    const ovulationDate = new Date(nextPeriodDate);
    ovulationDate.setDate(ovulationDate.getDate() - 14);

    const fertileStart = new Date(ovulationDate);
    fertileStart.setDate(fertileStart.getDate() - 5);

    const fertileEnd = new Date(ovulationDate);
    fertileEnd.setDate(fertileEnd.getDate() + 1);

    const today = new Date();
    const daysUntilNextPeriod = Math.round(
      (nextPeriodDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    const currentCycleDay = Math.round(
      (today.getTime() - lastStartDate.getTime()) / (1000 * 60 * 60 * 24) + 1,
    );

    return {
      averageCycleLength,
      currentCycleDay,
      daysUntilNextPeriod,
      nextPeriod: {
        date: nextPeriodDate.toISOString().split('T')[0],
        daysUntil: daysUntilNextPeriod,
      },
      ovulationDate: {
        date: ovulationDate.toISOString().split('T')[0],
      },
      fertileWindow: {
        start: fertileStart.toISOString().split('T')[0],
        end: fertileEnd.toISOString().split('T')[0],
      },
      basedOnCycles: cycles.length,
    };
  }
}
