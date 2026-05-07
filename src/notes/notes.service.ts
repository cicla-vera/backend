import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateNoteDto) {
    return this.prisma.note.create({
      data: {
        userId,
        content: dto.content,
        date: new Date(dto.date),
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.note.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async findByDate(userId: string, date: string) {
    return this.prisma.note.findMany({
      where: {
        userId,
        date: new Date(date),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(userId: string, id: string, dto: UpdateNoteDto) {
    const note = await this.prisma.note.findFirst({
      where: { id, userId },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    return this.prisma.note.update({
      where: { id },
      data: { content: dto.content },
    });
  }

  async remove(userId: string, id: string) {
    return this.prisma.note.deleteMany({
      where: { id, userId },
    });
  }
}
