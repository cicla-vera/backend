import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import { VeraController } from './vera.controller';
import { VeraService } from './vera.service';

@Module({
  imports: [AuthModule],
  controllers: [VeraController, EmergencyContactsController],
  providers: [VeraService, EmergencyContactsService],
  exports: [VeraService, EmergencyContactsService],
})
export class VeraModule {}
