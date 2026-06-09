import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RecordVeraLocationHistoryDto } from './dto/record-vera-location-history.dto';
import { VeraLocationHistoryService } from './vera-location-history.service';

@UseGuards(JwtGuard)
@Controller('vera/location-history')
export class VeraLocationHistoryController {
  constructor(
    private readonly locationHistoryService: VeraLocationHistoryService,
  ) {}

  @Post()
  record(
    @CurrentUser() user: { sub: string },
    @Body() dto: RecordVeraLocationHistoryDto,
  ) {
    return this.locationHistoryService.record(user.sub, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: { sub: string },
    @Query('limit') limit?: string,
  ) {
    return this.locationHistoryService.findAll(user.sub, limit);
  }
}
