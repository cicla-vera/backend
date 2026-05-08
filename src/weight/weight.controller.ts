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
import { WeightService } from './weight.service';
import { CreateWeightEntryDto } from './dto/create-weight-entry.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('weight')
export class WeightController {
  constructor(private readonly weightService: WeightService) {}

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateWeightEntryDto,
  ) {
    return this.weightService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }, @Query('date') date?: string) {
    if (date) {
      return this.weightService.findByDate(user.sub, date);
    }
    return this.weightService.findAll(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.weightService.remove(user.sub, id);
  }
}
