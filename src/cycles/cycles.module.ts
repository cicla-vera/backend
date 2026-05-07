import { Module } from '@nestjs/common';
import { CyclesService } from './cycles.service';
import { CyclesController } from './cycles.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CyclesController],
  providers: [CyclesService],
  exports: [CyclesService],
})
export class CyclesModule {}
