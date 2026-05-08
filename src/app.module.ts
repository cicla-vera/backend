import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CyclesModule } from './cycles/cycles.module';
import { SymptomsModule } from './symptoms/symptoms.module';
import { MoodsModule } from './moods/moods.module';
import { FlowModule } from './flow/flow.module';
import { NotesModule } from './notes/notes.module';
import { TemperatureModule } from './temperature/temperature.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CyclesModule,
    SymptomsModule,
    MoodsModule,
    FlowModule,
    NotesModule,
    TemperatureModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
