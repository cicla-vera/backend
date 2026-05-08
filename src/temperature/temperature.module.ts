import { Module } from '@nestjs/common';
import { TemperatureService } from './temperature.service';
import { TemperatureController } from './temperature.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TemperatureController],
  providers: [TemperatureService],
})
export class TemperatureModule {}
