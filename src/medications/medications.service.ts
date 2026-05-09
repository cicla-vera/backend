import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMedicationEntryDto } from './dto/create-medication-entry.dto';

@Injectable()
export class MedicationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateMedicationEntryDto) {
    return this.prisma.medicationEntry.create({
      data: {
        userId,
        name: dto.name,
        dose: dto.dose,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.medicationEntry.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.medicationEntry.findMany({
      where: { userId, date: new Date(date) },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.medicationEntry.deleteMany({
      where: { id, userId },
    });
  }
}
