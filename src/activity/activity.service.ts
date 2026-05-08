import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityEntryDto } from './dto/create-activity-entry.dto';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateActivityEntryDto) {
    return this.prisma.activityEntry.create({
      data: {
        userId,
        type: dto.type,
        intensity: dto.intensity,
        duration: dto.duration,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.activityEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.activityEntry.findMany({
      where: { userId, date: new Date(date) },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.activityEntry.deleteMany({
      where: { id, userId },
    });
  }
}
