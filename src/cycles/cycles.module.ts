import { Module } from '@nestjs/common';
import { CyclesService } from './cycles.service';
import { CyclesController } from './cycles.controller';
import { AuthModule } from '../auth/auth.module';
import { CyclesPredictionService } from './cycles.prediction.service';

@Module({
  imports: [AuthModule],
  controllers: [CyclesController],
  providers: [CyclesService, CyclesPredictionService],
  exports: [CyclesService, CyclesPredictionService],
})
export class CyclesModule {}
