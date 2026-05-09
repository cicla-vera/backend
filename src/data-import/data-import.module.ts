import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';

@Module({
  imports: [AuthModule],
  controllers: [DataImportController],
  providers: [DataImportService],
})
export class DataImportModule {}
