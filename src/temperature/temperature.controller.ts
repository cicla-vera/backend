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
import { TemperatureService } from './temperature.service';
import { CreateTemperatureEntryDto } from './dto/create-temperature-entry.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('temperature')
export class TemperatureController {
  constructor(private readonly temperatureService: TemperatureService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateTemperatureEntryDto,
  ) {
    return this.temperatureService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.temperatureService.findByDate(user.sub, date);
    }
    return this.temperatureService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.temperatureService.remove(user.sub, id);
  }
}
