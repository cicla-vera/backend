import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SleepController } from './sleep.controller';
import { SleepService } from './sleep.service';

@Module({
  imports: [AuthModule],
  controllers: [SleepController],
  providers: [SleepService],
})
export class SleepModule {}
