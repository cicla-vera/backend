import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateCycleDto } from './dto/update-cycle.dto';

@Injectable()
export class CyclesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateCycleDto) {
    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;

    const duration = endDate
      ? Math.round(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    return this.prisma.cycleLog.create({
      data: {
        userId,
        startDate,
        endDate,
        duration,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const cycle = await this.prisma.cycleLog.findFirst({
      where: { id, userId },
    });

    if (!cycle) {
      throw new NotFoundException('Cycle not found');
    }

    return cycle;
  }

  async update(userId: string, id: string, dto: UpdateCycleDto) {
    await this.findOne(userId, id);

    const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;

    let duration: number | undefined;
    if (startDate && endDate) {
      duration = Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    return this.prisma.cycleLog.update({
      where: { id },
      data: { startDate, endDate, duration },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.cycleLog.delete({ where: { id } });
  }

  async getHistory(userId: string) {
    const cycles = await this.prisma.cycleLog.findMany({
      where: { userId, endDate: { not: null } },
      orderBy: { startDate: 'desc' },
    });

    const durations = cycles
      .filter((c) => c.duration !== null)
      .map((c) => c.duration as number);

    const averageDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    return {
      cycles,
      stats: {
        totalCycles: cycles.length,
        averageDuration,
        shortest: durations.length > 0 ? Math.min(...durations) : null,
        longest: durations.length > 0 ? Math.max(...durations) : null,
      },
    };
  }
}
