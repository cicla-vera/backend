import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VeraController } from './vera.controller';
import { VeraService } from './vera.service';

@Module({
  imports: [AuthModule],
  controllers: [VeraController],
  providers: [VeraService],
  exports: [VeraService],
})
export class VeraModule {}
