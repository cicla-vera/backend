import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import { SafetyLocationsController } from './safety-locations.controller';
import { SafetyLocationsService } from './safety-locations.service';
import { VeraController } from './vera.controller';
import { VeraService } from './vera.service';

@Module({
  imports: [AuthModule],
  controllers: [
    VeraController,
    EmergencyContactsController,
    SafetyLocationsController,
  ],
  providers: [VeraService, EmergencyContactsService, SafetyLocationsService],
  exports: [VeraService, EmergencyContactsService, SafetyLocationsService],
})
export class VeraModule {}
