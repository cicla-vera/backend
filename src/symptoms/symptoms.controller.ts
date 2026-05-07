import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SymptomsService } from './symptoms.service';
import { CreateSymptomEntryDto } from './dto/create-symptom-entry.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('symptoms')
export class SymptomsController {
  constructor(private readonly symptomsService: SymptomsService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateSymptomEntryDto,
  ) {
    return this.symptomsService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.symptomsService.findByDate(user.sub, date);
    }
    return this.symptomsService.findAll(user.sub);
  }

  @Get('available')
  getAvailable() {
    return this.symptomsService.getAvailableSymptoms();
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.symptomsService.remove(user.sub, id);
  }
}
