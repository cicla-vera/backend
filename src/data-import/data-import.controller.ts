import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { DataImportService } from './data-import.service';

@UseGuards(JwtGuard)
@Controller('import')
export class DataImportController {
  constructor(private readonly dataImportService: DataImportService) {}

  @Post('flo')
  importFlo(@CurrentUser() user: { sub: string }, @Body() payload: unknown) {
    return this.dataImportService.importFlo(user.sub, payload);
  }
}
