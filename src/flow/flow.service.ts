import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlowEntryDto } from './dto/create-flow-entry.dto';

@Injectable()
export class FlowService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateFlowEntryDto) {
    return this.prisma.flowEntry.create({
      data: {
        userId,
        intensity: dto.intensity,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.flowEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.flowEntry.findMany({
      where: {
        userId,
        date: new Date(date),
      },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.flowEntry.deleteMany({
      where: { id, userId },
    });
  }
}
