import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSymptomEntryDto } from './dto/create-symptom-entry.dto';

@Injectable()
export class SymptomsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateSymptomEntryDto) {
    const symptom = await this.prisma.symptom.upsert({
      where: { name: dto.symptomName },
      update: {},
      create: { name: dto.symptomName },
    });

    return this.prisma.symptomEntry.create({
      data: {
        userId,
        symptomId: symptom.id,
        date: new Date(dto.date),
        intensity: dto.intensity,
      },
      include: { symptom: true },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.symptomEntry.findMany({
      where: {
        userId,
        date: new Date(date),
      },
      include: { symptom: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(userId: string) {
    return this.prisma.symptomEntry.findMany({
      where: { userId },
      include: { symptom: true },
      orderBy: { date: 'desc' },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.symptomEntry.deleteMany({
      where: { id, userId },
    });
  }

  async getAvailableSymptoms() {
    return this.prisma.symptom.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
