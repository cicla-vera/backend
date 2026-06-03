import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EvidenceAnalysisService } from './evidence-analysis.service';

const DEFAULT_WORKER_BATCH_SIZE = 4;
const DEFAULT_WORKER_POLL_MS = 1000;

@Injectable()
export class EvidenceAnalysisWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EvidenceAnalysisWorkerService.name);
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private evidenceAnalysisService: EvidenceAnalysisService) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      return;
    }

    this.interval = setInterval(
      () => {
        void this.runOnce();
      },
      this.getEnvInteger(
        'VERA_AI_ANALYSIS_WORKER_POLL_MS',
        DEFAULT_WORKER_POLL_MS,
        250,
        60_000,
      ),
    );
    this.interval.unref();
    void this.runOnce();
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const batchSize = this.getEnvInteger(
        'VERA_AI_ANALYSIS_WORKER_BATCH_SIZE',
        DEFAULT_WORKER_BATCH_SIZE,
        1,
        50,
      );

      for (let index = 0; index < batchSize; index += 1) {
        const processed =
          await this.evidenceAnalysisService.processNextQueuedAnalysis();

        if (!processed) {
          break;
        }
      }
    } catch {
      this.logger.warn('Vera evidence analysis worker cycle failed safely.');
    } finally {
      this.running = false;
    }
  }

  private isEnabled(): boolean {
    return !['0', 'false', 'no', 'off'].includes(
      process.env.VERA_AI_ANALYSIS_WORKER_ENABLED?.trim().toLowerCase() ?? '',
    );
  }

  private getEnvInteger(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = Number(process.env[name]);

    return Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  }
}
