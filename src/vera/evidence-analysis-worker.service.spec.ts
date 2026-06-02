import { EvidenceAnalysisService } from './evidence-analysis.service';
import { EvidenceAnalysisWorkerService } from './evidence-analysis-worker.service';

describe('EvidenceAnalysisWorkerService', () => {
  const originalEnv = process.env;
  let evidenceAnalysisService: {
    processNextQueuedAnalysis: jest.Mock;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    evidenceAnalysisService = {
      processNextQueuedAnalysis: jest.fn(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes queued jobs until the current batch is empty', async () => {
    evidenceAnalysisService.processNextQueuedAnalysis
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const worker = new EvidenceAnalysisWorkerService(
      evidenceAnalysisService as unknown as EvidenceAnalysisService,
    );

    await worker.runOnce();

    expect(
      evidenceAnalysisService.processNextQueuedAnalysis,
    ).toHaveBeenCalledTimes(3);
  });

  it('limits each worker cycle to the configured batch size', async () => {
    process.env.VERA_AI_ANALYSIS_WORKER_BATCH_SIZE = '2';
    evidenceAnalysisService.processNextQueuedAnalysis.mockResolvedValue(true);
    const worker = new EvidenceAnalysisWorkerService(
      evidenceAnalysisService as unknown as EvidenceAnalysisService,
    );

    await worker.runOnce();

    expect(
      evidenceAnalysisService.processNextQueuedAnalysis,
    ).toHaveBeenCalledTimes(2);
  });

  it('contains unexpected processing failures inside the worker cycle', async () => {
    evidenceAnalysisService.processNextQueuedAnalysis.mockRejectedValue(
      new Error('database unavailable'),
    );
    const worker = new EvidenceAnalysisWorkerService(
      evidenceAnalysisService as unknown as EvidenceAnalysisService,
    );

    await expect(worker.runOnce()).resolves.toBeUndefined();
  });
});
