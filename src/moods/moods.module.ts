import { Module } from '@nestjs/common';
import { MoodsService } from './moods.service';
import { MoodsController } from './moods.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MoodsController],
  providers: [MoodsService],
})
export class MoodsModule {}
