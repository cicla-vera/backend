import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiController } from './ai.controller';
import { AiServiceClient } from './ai-service.client';

@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiServiceClient],
  exports: [AiServiceClient],
})
export class AiModule {}
