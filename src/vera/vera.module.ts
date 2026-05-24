import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
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
  ],
  providers: [
    VeraService,
    EmergencyContactsService,
    SafetyLocationsService,
    VeraPinService,
  ],
  exports: [
    VeraService,
    EmergencyContactsService,
    SafetyLocationsService,
    VeraPinService,
  ],
})
export class VeraModule {}
