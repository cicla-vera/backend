import { Test, TestingModule } from '@nestjs/testing';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { EvidenceAnalysisService } from './evidence-analysis.service';
import { EvidenceExportService } from './evidence-export.service';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { ExecutionContext } from '@nestjs/common';

describe('EvidenceController', () => {
  let controller: EvidenceController;
  let exportService: EvidenceExportService;

  const mockUser = { sub: 'user-id' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EvidenceController],
      providers: [
        {
          provide: EvidenceService,
          useValue: {
            findAll: jest.fn(),
            upload: jest.fn(),
            verify: jest.fn(),
            hideFromUser: jest.fn(),
          },
        },
        {
          provide: EvidenceAnalysisService,
          useValue: {
            analyze: jest.fn(),
            findLatest: jest.fn(),
          },
        },
        {
          provide: EvidenceExportService,
          useValue: {
            createManifest: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = mockUser;
          return true;
        },
      })
      .compile();

    controller = module.get<EvidenceController>(EvidenceController);
    exportService = module.get<EvidenceExportService>(EvidenceExportService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('exportManifest', () => {
    it('should call EvidenceExportService.createManifest', async () => {
      const alertSessionId = 'session-id';
      const expectedManifest = { id: 'manifest-id' } as any;
      jest.spyOn(exportService, 'createManifest').mockResolvedValue(expectedManifest);

      const result = await controller.exportManifest(mockUser, alertSessionId);

      expect(exportService.createManifest).toHaveBeenCalledWith(mockUser.sub, alertSessionId);
      expect(result).toBe(expectedManifest);
    });
  });
});
