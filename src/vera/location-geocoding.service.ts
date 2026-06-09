import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

export type GeocodingPlace = {
  address: string | null;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
  source: string;
};

type NominatimSearchResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
  osm_id?: number;
  place_id?: number;
};

type NominatimReverseResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
  osm_id?: number;
  place_id?: number;
};

const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_COUNTRY_CODES = 'br';
const DEFAULT_LIMIT = 5;
const MAX_QUERY_LENGTH = 180;

@Injectable()
export class LocationGeocodingService {
  async search(
    query: string,
    limit = DEFAULT_LIMIT,
  ): Promise<GeocodingPlace[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const normalizedLimit = this.normalizeLimit(limit);
    const params = new URLSearchParams({
      addressdetails: '1',
      countrycodes:
        process.env.GEOCODING_COUNTRY_CODES ?? DEFAULT_COUNTRY_CODES,
      format: 'jsonv2',
      limit: String(normalizedLimit),
      q: normalizedQuery,
    });

    const response = await this.request<NominatimSearchResult[]>(
      `/search?${params.toString()}`,
    );

    return response
      .map((place) => this.normalizePlace(place))
      .filter((place): place is GeocodingPlace => place !== null);
  }

  async reverse(
    latitude: number,
    longitude: number,
  ): Promise<GeocodingPlace | null> {
    this.assertCoordinates(latitude, longitude);

    const params = new URLSearchParams({
      addressdetails: '1',
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
    });
    const response = await this.request<NominatimReverseResult>(
      `/reverse?${params.toString()}`,
    );

    return this.normalizePlace(response);
  }

  private async request<T>(path: string): Promise<T> {
    const baseUrl = (
      process.env.NOMINATIM_BASE_URL ?? DEFAULT_NOMINATIM_BASE_URL
    ).replace(/\/+$/, '');
    const userAgent =
      process.env.GEOCODING_USER_AGENT ??
      'CiclaVeraMVP/1.0 (contact: development)';

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `Geocoding provider responded with status ${response.status}.`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException('Geocoding provider request failed.');
    }
  }

  private normalizePlace(
    place: NominatimSearchResult | NominatimReverseResult,
  ): GeocodingPlace | null {
    const latitude = Number(place.lat);
    const longitude = Number(place.lon);
    const formattedAddress = place.display_name?.trim();

    if (
      !formattedAddress ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    return {
      address: formattedAddress,
      formattedAddress,
      latitude,
      longitude,
      placeId:
        place.place_id !== undefined
          ? String(place.place_id)
          : place.osm_id !== undefined
            ? String(place.osm_id)
            : null,
      source: 'nominatim',
    };
  }

  private normalizeQuery(query: string): string {
    const normalized = query.trim();

    if (normalized.length < 3) {
      throw new BadRequestException(
        'Address search must have at least 3 characters.',
      );
    }

    if (normalized.length > MAX_QUERY_LENGTH) {
      throw new BadRequestException('Address search is too long.');
    }

    return normalized;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
      return DEFAULT_LIMIT;
    }

    return Math.max(1, Math.min(10, Math.round(limit)));
  }

  private assertCoordinates(latitude: number, longitude: number): void {
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException('Invalid coordinates.');
    }
  }
}
