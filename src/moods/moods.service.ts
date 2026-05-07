import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMoodEntryDto } from './dto/create-mood-entry.dto';

@Injectable()
export class MoodsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateMoodEntryDto) {
    return this.prisma.moodEntry.create({
      data: {
        userId,
        mood: dto.mood,
        date: new Date(dto.date),
        note: dto.note,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.moodEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.moodEntry.findMany({
      where: {
        userId,
        date: new Date(date),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.moodEntry.deleteMany({
      where: { id, userId },
    });
  }
}
