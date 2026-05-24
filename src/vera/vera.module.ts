import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AlertEventsController } from './alert-events.controller';
import { AlertEventsService } from './alert-events.service';
import { AlertSessionsController } from './alert-sessions.controller';
import { AlertSessionsService } from './alert-sessions.service';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import { EvidenceStorageService } from './evidence-storage.service';
import { SafetyLocationsController } from './safety-locations.controller';
import { SafetyLocationsService } from './safety-locations.service';
import { VeraPinController } from './vera-pin.controller';
import { VeraPinService } from './vera-pin.service';
import { VeraController } from './vera.controller';
import { VeraService } from './vera.service';

@Module({
  imports: [AuthModule],
  controllers: [
    VeraController,
    EmergencyContactsController,
    SafetyLocationsController,
    VeraPinController,
    AlertSessionsController,
    AlertEventsController,
  ],
  providers: [
    VeraService,
    EmergencyContactsService,
    SafetyLocationsService,
    VeraPinService,
    AlertSessionsService,
    AlertEventsService,
    EvidenceStorageService,
  ],
  exports: [
    VeraService,
    EmergencyContactsService,
    SafetyLocationsService,
    VeraPinService,
    AlertSessionsService,
    AlertEventsService,
    EvidenceStorageService,
  ],
})
export class VeraModule {}
