import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWaterEntryDto } from './dto/create-water-entry.dto';

@Injectable()
export class WaterService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateWaterEntryDto) {
    return this.prisma.waterEntry.create({
      data: {
        userId,
        amount: dto.amount,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.waterEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    const entries = await this.prisma.waterEntry.findMany({
      where: { userId, date: new Date(date) },
    });

    const total = entries.reduce((sum, e) => sum + e.amount, 0);

    return { entries, total };
  }

  async remove(userId: string, id: string) {
    return this.prisma.waterEntry.deleteMany({
      where: { id, userId },
    });
  }
}
