import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateMedicationEntryDto } from './dto/create-medication-entry.dto';
import { MedicationsService } from './medications.service';

@UseGuards(JwtGuard)
@Controller('medications')
export class MedicationsController {
  constructor(private readonly medicationsService: MedicationsService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateMedicationEntryDto,
  ) {
    return this.medicationsService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.medicationsService.findByDate(user.sub, date);
    }

    return this.medicationsService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.medicationsService.remove(user.sub, id);
  }
}
