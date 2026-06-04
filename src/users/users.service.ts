import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      name: user.profile?.name,
      phone: user.profile?.phone,
      phoneVerifiedAt: user.profile?.phoneVerifiedAt ?? null,
      birthDate: user.profile?.birthDate,
      cpf: user.profile?.cpf,
      createdAt: user.createdAt,
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.profile.update({
      where: { userId },
      data: {
        name: dto.name,
        phone: dto.phone,
        phoneVerifiedAt:
          dto.phone !== undefined && dto.phone !== user.profile?.phone
            ? null
            : undefined,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        cpf: dto.cpf,
      },
    });

    return {
      id: userId,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      name: updated.name,
      phone: updated.phone,
      phoneVerifiedAt: updated.phoneVerifiedAt,
      birthDate: updated.birthDate,
      cpf: updated.cpf,
    };
  }
}
