import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { AlertEventsController } from './alert-events.controller';
import { AlertEventsService } from './alert-events.service';
import { AlertLocationSamplesService } from './alert-location-samples.service';
import { AlertSessionsController } from './alert-sessions.controller';
import { AlertSessionsService } from './alert-sessions.service';
import { AudioScreeningController } from './audio-screening.controller';
import { AudioScreeningService } from './audio-screening.service';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import { EmergencyDispatchService } from './emergency-dispatch.service';
import { EvidenceController } from './evidence.controller';
import { EvidenceAnalysisService } from './evidence-analysis.service';
import { EvidenceAnalysisWorkerService } from './evidence-analysis-worker.service';
import { EvidenceExportService } from './evidence-export.service';
import { EvidenceService } from './evidence.service';
import { EvidenceStorageService } from './evidence-storage.service';
import { EvidenceTimestampService } from './evidence-timestamp.service';
import { LocationGeocodingController } from './location-geocoding.controller';
import { LocationGeocodingService } from './location-geocoding.service';
import { MessagingProviderService } from './messaging-provider.service';
import { SafetyLocationsController } from './safety-locations.controller';
import { SafetyLocationsService } from './safety-locations.service';
import { VeraPinController } from './vera-pin.controller';
import { VeraPinService } from './vera-pin.service';
import { VeraLocationHistoryController } from './vera-location-history.controller';
import { VeraLocationHistoryService } from './vera-location-history.service';
import { VeraController } from './vera.controller';
import { VeraService } from './vera.service';

@Module({
  imports: [AuthModule, AiModule],
  controllers: [
    VeraController,
    EmergencyContactsController,
    SafetyLocationsController,
    VeraPinController,
    AlertSessionsController,
    AlertEventsController,
    EvidenceController,
    LocationGeocodingController,
    VeraLocationHistoryController,
    AudioScreeningController,
  ],
  providers: [
    VeraService,
    EmergencyContactsService,
    SafetyLocationsService,
    VeraPinService,
    AlertSessionsService,
    AlertLocationSamplesService,
    AlertEventsService,
    EmergencyDispatchService,
    MessagingProviderService,
    EvidenceAnalysisService,
    EvidenceAnalysisWorkerService,
    EvidenceExportService,
    EvidenceService,
    EvidenceStorageService,
    EvidenceTimestampService,
    LocationGeocodingService,
    VeraLocationHistoryService,
    AudioScreeningService,
  ],
  exports: [
    VeraService,
    EmergencyContactsService,
    SafetyLocationsService,
    VeraPinService,
    AlertSessionsService,
    AlertLocationSamplesService,
    AlertEventsService,
    EmergencyDispatchService,
    MessagingProviderService,
    EvidenceAnalysisService,
    EvidenceExportService,
    EvidenceService,
    EvidenceStorageService,
    EvidenceTimestampService,
    LocationGeocodingService,
    VeraLocationHistoryService,
    AudioScreeningService,
  ],
})
export class VeraModule {}
