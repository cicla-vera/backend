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
import { WaterService } from './water.service';
import { CreateWaterEntryDto } from './dto/create-water-entry.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('water')
export class WaterController {
  constructor(private readonly waterService: WaterService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateWaterEntryDto,
  ) {
    return this.waterService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.waterService.findByDate(user.sub, date);
    }
    return this.waterService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.waterService.remove(user.sub, id);
  }
}
