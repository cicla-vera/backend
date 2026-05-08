import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSleepEntryDto } from './dto/create-sleep-entry.dto';

@Injectable()
export class SleepService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateSleepEntryDto) {
    return this.prisma.sleepEntry.create({
      data: {
        userId,
        hours: dto.hours,
        quality: dto.quality,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.sleepEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.sleepEntry.findMany({
      where: { userId, date: new Date(date) },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.sleepEntry.deleteMany({
      where: { id, userId },
    });
  }
}
