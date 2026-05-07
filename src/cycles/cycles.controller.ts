import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CyclesService } from './cycles.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateCycleDto } from './dto/update-cycle.dto';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtGuard)
@Controller('cycles')
export class CyclesController {
  constructor(private readonly cyclesService: CyclesService) {}

  @Post()
  create(@CurrentUser() user: { sub: string }, @Body() dto: CreateCycleDto) {
    return this.cyclesService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { sub: string }) {
    return this.cyclesService.findAll(user.sub);
  }

  @Get('history')
  getHistory(@CurrentUser() user: { sub: string }) {
    return this.cyclesService.getHistory(user.sub);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.cyclesService.findOne(user.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { sub: string },
    @Param('id') id: string,
    @Body() dto: UpdateCycleDto,
  ) {
    return this.cyclesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.cyclesService.remove(user.sub, id);
  }
}
