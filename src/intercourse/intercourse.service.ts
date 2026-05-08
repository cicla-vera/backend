import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIntercourseEntryDto } from './dto/create-intercourse-entry.dto';

@Injectable()
export class IntercourseService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateIntercourseEntryDto) {
    return this.prisma.intercourseEntry.create({
      data: {
        userId,
        protected: dto.protected,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.intercourseEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.intercourseEntry.findMany({
      where: { userId, date: new Date(date) },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.intercourseEntry.deleteMany({
      where: { id, userId },
    });
  }
}
