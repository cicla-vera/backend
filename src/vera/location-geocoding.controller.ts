import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { LocationGeocodingService } from './location-geocoding.service';

@UseGuards(JwtGuard)
@Controller('vera/geocoding')
export class LocationGeocodingController {
  constructor(private readonly geocodingService: LocationGeocodingService) {}

  @Get('search')
  search(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.geocodingService.search(query ?? '', Number(limit));
  }

  @Get('reverse')
  reverse(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
  ) {
    return this.geocodingService.reverse(Number(latitude), Number(longitude));
  }
}
