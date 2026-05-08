import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWeightEntryDto } from './dto/create-weight-entry.dto';

@Injectable()
export class WeightService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateWeightEntryDto) {
    return this.prisma.weightEntry.create({
      data: {
        userId,
        weight: dto.weight,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.weightEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.weightEntry.findMany({
      where: { userId, date: new Date(date) },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.weightEntry.deleteMany({
      where: { id, userId },
    });
  }
}
