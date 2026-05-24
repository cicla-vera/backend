import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AlertEventType,
  AlertLevel,
  EvidenceAnalysisStatus,
  type EvidenceAnalysis,
  type EvidenceRecord,
} from '@prisma/client';
import {
  AiServiceClient,
  type AnalyzeEvidenceResponse,
} from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';

type EvidenceAnalysisResponse = {
  id: string;
  evidenceRecordId: string;
  alertSessionId: string;
  status: EvidenceAnalysisStatus;
  riskLevel: string | null;
  suggestedAlertLevel: AlertLevel | null;
  confidence: number | null;
  summary: string | null;
  detectedSignals: unknown;
  shouldEscalate: boolean | null;
  failureReason: string | null;
  createdAt: Date;
};

@Injectable()
export class EvidenceAnalysisService {
  constructor(
    private prisma: PrismaService,
    private aiServiceClient: AiServiceClient,
  ) {}

  async analyze(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceAnalysisResponse> {
    const evidenceRecord = await this.findUserVisibleEvidence(
      userId,
      alertSessionId,
      evidenceRecordId,
    );

    try {
      const aiResult = await this.aiServiceClient.analyzeEvidence({
        evidenceRecordId: evidenceRecord.id,
        alertSessionId: evidenceRecord.alertSessionId,
        evidenceType: evidenceRecord.type,
        mimeType: evidenceRecord.mimeType,
        size: evidenceRecord.size,
        contentHash: evidenceRecord.contentHash,
      });

      return this.persistCompletedAnalysis(userId, evidenceRecord, aiResult);
    } catch (error) {
      return this.persistFailedAnalysis(
        userId,
        evidenceRecord,
        this.getSafeFailureReason(error),
      );
    }
  }

  private async findUserVisibleEvidence(
    userId: string,
    alertSessionId: string,
    evidenceRecordId: string,
  ): Promise<EvidenceRecord> {
    const evidenceRecord = await this.prisma.evidenceRecord.findFirst({
      where: {
        id: evidenceRecordId,
        userId,
        alertSessionId,
        hiddenFromUserAt: null,
        deletedAt: null,
      },
    });

    if (!evidenceRecord) {
      throw new NotFoundException('Evidence record not found');
    }

    return evidenceRecord;
  }

  private async persistCompletedAnalysis(
    userId: string,
    evidenceRecord: EvidenceRecord,
    aiResult: AnalyzeEvidenceResponse,
  ): Promise<EvidenceAnalysisResponse> {
    const suggestedAlertLevel = this.getSuggestedAlertLevel(aiResult);
    const analysis = await this.prisma.$transaction(async (tx) => {
      const evidenceAnalysis = await tx.evidenceAnalysis.create({
        data: {
          userId,
          alertSessionId: evidenceRecord.alertSessionId,
          evidenceRecordId: evidenceRecord.id,
          status: EvidenceAnalysisStatus.COMPLETED,
          riskLevel: aiResult.riskLevel,
          suggestedAlertLevel,
          confidence: aiResult.confidence,
          summary: aiResult.summary,
          detectedSignals: aiResult.detectedSignals,
          shouldEscalate: aiResult.shouldEscalate,
        },
      });

      await tx.alertEvent.create({
        data: {
          userId,
          alertSessionId: evidenceRecord.alertSessionId,
          type: AlertEventType.AI_ANALYSIS_COMPLETED,
          message: 'AI analysis completed.',
          metadata: {
            status: evidenceAnalysis.status,
            evidenceAnalysisId: evidenceAnalysis.id,
            evidenceRecordId: evidenceRecord.id,
            riskLevel: evidenceAnalysis.riskLevel,
            confidence: evidenceAnalysis.confidence,
            shouldEscalate: evidenceAnalysis.shouldEscalate,
            suggestedAlertLevel,
          },
        },
      });

      return evidenceAnalysis;
    });

    return this.toResponse(analysis);
  }

  private async persistFailedAnalysis(
    userId: string,
    evidenceRecord: EvidenceRecord,
    failureReason: string,
  ): Promise<EvidenceAnalysisResponse> {
    const analysis = await this.prisma.$transaction(async (tx) => {
      const evidenceAnalysis = await tx.evidenceAnalysis.create({
        data: {
          userId,
          alertSessionId: evidenceRecord.alertSessionId,
          evidenceRecordId: evidenceRecord.id,
          status: EvidenceAnalysisStatus.FAILED,
          failureReason,
        },
      });

      await tx.alertEvent.create({
        data: {
          userId,
          alertSessionId: evidenceRecord.alertSessionId,
          type: AlertEventType.AI_ANALYSIS_COMPLETED,
          message: 'AI analysis failed.',
          metadata: {
            status: evidenceAnalysis.status,
            evidenceAnalysisId: evidenceAnalysis.id,
            evidenceRecordId: evidenceRecord.id,
            failureReason,
          },
        },
      });

      return evidenceAnalysis;
    });

    return this.toResponse(analysis);
  }

  private getSuggestedAlertLevel(
    aiResult: AnalyzeEvidenceResponse,
  ): AlertLevel {
    if (aiResult.shouldEscalate || aiResult.riskLevel === 'CRITICAL') {
      return AlertLevel.CRITICAL;
    }

    return AlertLevel.NORMAL;
  }

  private getSafeFailureReason(error: unknown): string {
    if (error instanceof HttpException) {
      return `ai_service_http_${error.getStatus()}`;
    }

    return 'ai_service_failed';
  }

  private toResponse(analysis: EvidenceAnalysis): EvidenceAnalysisResponse {
    return {
      id: analysis.id,
      evidenceRecordId: analysis.evidenceRecordId,
      alertSessionId: analysis.alertSessionId,
      status: analysis.status,
      riskLevel: analysis.riskLevel,
      suggestedAlertLevel: analysis.suggestedAlertLevel,
      confidence: analysis.confidence,
      summary: analysis.summary,
      detectedSignals: analysis.detectedSignals,
      shouldEscalate: analysis.shouldEscalate,
      failureReason: analysis.failureReason,
      createdAt: analysis.createdAt,
    };
  }
}
