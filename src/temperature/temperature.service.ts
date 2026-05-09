import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemperatureEntryDto } from './dto/create-temperature-entry.dto';

@Injectable()
export class TemperatureService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateTemperatureEntryDto) {
    return this.prisma.temperatureEntry.create({
      data: {
        userId,
        temperature: dto.temperature,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.temperatureEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.temperatureEntry.findMany({
      where: { userId, date: new Date(date) },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.temperatureEntry.deleteMany({
      where: { id, userId },
    });
  }
}
