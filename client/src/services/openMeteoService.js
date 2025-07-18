import axios from 'axios';

/**
 * Service Open-Meteo - Source météo gratuite principale
 * - 10,000 appels/jour gratuits
 * - Pas de clé API requise
 * - Données ECMWF haute qualité
 * - Couverture mondiale
 */
class OpenMeteoService {
  constructor() {
    this.baseUrl = 'https://api.open-meteo.com/v1';
    this.name = 'Open-Meteo';
    this.isAvailable = true;
  }

  /**
   * Obtenir les données météo actuelles par coordonnées
   */
  async getWeatherByCoords(lat, lon, language = 'en') {
    try {
      const url = `${this.baseUrl}/forecast`;
      const params = {
        latitude: lat,
        longitude: lon,
        current: [
          'temperature_2m',
          'relative_humidity_2m', 
          'apparent_temperature',
          'precipitation',
          'wind_speed_10m',
          'wind_direction_10m',
          'weather_code'
        ].join(','),
        daily: [
          'weather_code',
          'temperature_2m_max',
          'temperature_2m_min',
          'precipitation_sum',
          'wind_speed_10m_max'
        ].join(','),
        timezone: 'auto',
        forecast_days: 7
      };

      const response = await axios.get(url, { params });
      const weatherData = this.transformCurrentWeatherData(response.data, lat, lon);
      
      // Essayer de récupérer le nom de la ville via géocodage inverse
      try {
        const cityName = await this.reverseGeocode(lat, lon);
        if (cityName) {
          weatherData.name = cityName.name;
          if (cityName.country) {
            weatherData.sys = { country: cityName.country };
          }
        }
      } catch (reverseError) {
        console.warn('Reverse geocoding failed:', reverseError.message);
        // Garder le nom par défaut "Location"
      }
      
      return weatherData;
    } catch (error) {
      console.warn('Open-Meteo API error:', error.message);
      throw new Error(`Open-Meteo: ${error.message}`);
    }
  }

  /**
   * Obtenir les données météo par nom de ville
   */
  async getWeatherByCity(cityName, language = 'en') {
    try {
      // D'abord, géocoder la ville
      const coords = await this.geocodeCity(cityName);
      const weatherData = await this.getWeatherByCoords(coords.lat, coords.lon, language);
      
      // Remplacer le nom générique par le nom de la ville géocodée
      weatherData.name = coords.name || cityName;
      if (coords.country) {
        weatherData.sys = { country: coords.country };
      }
      
      return weatherData;
    } catch (error) {
      console.warn('Open-Meteo geocoding error:', error.message);
      throw new Error(`Open-Meteo geocoding: ${error.message}`);
    }
  }

  /**
   * Géocodage inverse pour obtenir le nom de la ville à partir des coordonnées
   */
  async reverseGeocode(lat, lon) {
    try {
      // Utiliser Nominatim (OpenStreetMap) pour le géocodage inverse gratuit
      const url = 'https://nominatim.openstreetmap.org/reverse';
      const params = {
        format: 'json',
        lat: lat,
        lon: lon,
        zoom: 10,
        addressdetails: 1
      };

      const response = await axios.get(url, { 
        params,
        headers: {
          'User-Agent': 'WeatherGlass/1.0 (https://github.com/kevinbdx35/WeatherGlass)'
        }
      });
      
      if (response.data && response.data.address) {
        const address = response.data.address;
        // Prioriser ville, puis village, puis suburb
        const cityName = address.city || address.town || address.village || address.suburb || address.hamlet;
        const country = address.country_code ? address.country_code.toUpperCase() : null;
        
        if (cityName) {
          return {
            name: cityName,
            country: country
          };
        }
      }
      
      return null;
    } catch (error) {
      throw new Error(`Reverse geocoding failed: ${error.message}`);
    }
  }

  /**
   * Géocodage via Open-Meteo Geocoding API (gratuit)
   */
  async geocodeCity(cityName) {
    try {
      const url = 'https://geocoding-api.open-meteo.com/v1/search';
      const params = {
        name: cityName,
        count: 1,
        language: 'en',
        format: 'json'
      };

      const response = await axios.get(url, { params });
      
      if (!response.data.results || response.data.results.length === 0) {
        throw new Error('City not found');
      }

      const result = response.data.results[0];
      return {
        lat: result.latitude,
        lon: result.longitude,
        name: result.name,
        country: result.country_code
      };
    } catch (error) {
      throw new Error(`Geocoding failed: ${error.message}`);
    }
  }

  /**
   * Transformer les données Open-Meteo vers le format OpenWeatherMap
   * pour compatibilité avec l'existant
   */
  transformCurrentWeatherData(data, lat, lon) {
    const current = data.current;
    // const daily = data.daily; // Réservé pour usage futur

    // Mapper les codes météo Open-Meteo vers OpenWeatherMap
    let weatherCodeToUse = this.mapWeatherCode(current.weather_code);
    
    // Vérification de sécurité
    if (!weatherCodeToUse) {
      console.warn('Weather code mapping failed for:', current.weather_code);
      weatherCodeToUse = { id: 800, main: 'Clear', description: 'clear sky', icon: '01d' };
    }

    return {
      coord: { lat, lon },
      weather: [{
        id: weatherCodeToUse.id,
        main: weatherCodeToUse.main,
        description: weatherCodeToUse.description,
        icon: weatherCodeToUse.icon
      }],
      main: {
        temp: Math.round(current.temperature_2m),
        feels_like: Math.round(current.apparent_temperature),
        humidity: Math.round(current.relative_humidity_2m),
        pressure: 1013 // Open-Meteo ne fournit pas la pression en gratuit
      },
      wind: {
        speed: Math.round(current.wind_speed_10m * 0.278), // Conversion km/h → m/s
        deg: current.wind_direction_10m
      },
      clouds: { all: 0 }, // Pas disponible en gratuit
      visibility: 10000, // Par défaut
      dt: Math.floor(new Date().getTime() / 1000),
      sys: {
        country: 'XX', // Sera rempli par le géocodage
        sunrise: Math.floor(new Date().setHours(6, 0, 0, 0) / 1000),
        sunset: Math.floor(new Date().setHours(18, 0, 0, 0) / 1000)
      },
      timezone: data.timezone_abbreviation || 'UTC',
      id: Math.floor(lat * 1000 + lon * 1000),
      name: 'Location', // Sera remplacé par le géocodage
      cod: 200,
      source: 'Open-Meteo',
      // Données spécifiques Open-Meteo
      raw_data: data
    };
  }

  /**
   * Obtenir les prévisions formatées pour 7 jours
   */
  getForecastData(data) {
    const daily = data.raw_data.daily;
    const forecasts = [];

    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
      const date = new Date(daily.time[i]);
      let weatherCode = this.mapWeatherCode(daily.weather_code[i]);
      
      // Vérification de sécurité
      if (!weatherCode) {
        console.warn('Weather code mapping failed for forecast:', daily.weather_code[i]);
        weatherCode = { id: 800, main: 'Clear', description: 'clear sky', icon: '01d' };
      }

      forecasts.push({
        dt: Math.floor(date.getTime() / 1000),
        dt_txt: date.toISOString(),
        main: {
          temp: Math.round((daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2),
          temp_max: Math.round(daily.temperature_2m_max[i]),
          temp_min: Math.round(daily.temperature_2m_min[i]),
          humidity: 60 // Valeur par défaut, Open-Meteo gratuit ne fournit pas l'humidité quotidienne
        },
        weather: [{
          id: weatherCode.id,
          main: weatherCode.main,
          description: weatherCode.description,
          icon: weatherCode.icon
        }],
        wind: {
          speed: Math.round(daily.wind_speed_10m_max[i] * 0.278) // km/h → m/s
        },
        rain: daily.precipitation_sum[i] ? { '3h': daily.precipitation_sum[i] } : undefined
      });
    }

    return forecasts;
  }

  /**
   * Mapping des codes météo Open-Meteo vers format OpenWeatherMap
   */
  mapWeatherCode(code) {
    if (code === undefined || code === null) {
      console.warn('Weather code is undefined or null');
      return null;
    }
    
    const weatherMap = {
      0: { id: 800, main: 'Clear', description: 'clear sky', icon: '01d' },
      1: { id: 801, main: 'Clouds', description: 'mainly clear', icon: '01d' },
      2: { id: 802, main: 'Clouds', description: 'partly cloudy', icon: '02d' },
      3: { id: 803, main: 'Clouds', description: 'overcast', icon: '03d' },
      45: { id: 741, main: 'Fog', description: 'fog', icon: '50d' },
      48: { id: 741, main: 'Fog', description: 'depositing rime fog', icon: '50d' },
      51: { id: 300, main: 'Drizzle', description: 'light drizzle', icon: '09d' },
      53: { id: 301, main: 'Drizzle', description: 'moderate drizzle', icon: '09d' },
      55: { id: 302, main: 'Drizzle', description: 'dense drizzle', icon: '09d' },
      61: { id: 500, main: 'Rain', description: 'slight rain', icon: '10d' },
      63: { id: 501, main: 'Rain', description: 'moderate rain', icon: '10d' },
      65: { id: 502, main: 'Rain', description: 'heavy rain', icon: '10d' },
      71: { id: 600, main: 'Snow', description: 'slight snow', icon: '13d' },
      73: { id: 601, main: 'Snow', description: 'moderate snow', icon: '13d' },
      75: { id: 602, main: 'Snow', description: 'heavy snow', icon: '13d' },
      95: { id: 200, main: 'Thunderstorm', description: 'thunderstorm', icon: '11d' },
      96: { id: 201, main: 'Thunderstorm', description: 'thunderstorm with slight hail', icon: '11d' },
      99: { id: 202, main: 'Thunderstorm', description: 'thunderstorm with heavy hail', icon: '11d' }
    };

    return weatherMap[code] || { id: 800, main: 'Clear', description: 'unknown', icon: '01d' };
  }

  /**
   * Vérifier la disponibilité du service
   */
  async checkAvailability() {
    try {
      const response = await axios.get(`${this.baseUrl}/forecast?latitude=48.8566&longitude=2.3522&current=temperature_2m`, {
        timeout: 5000
      });
      this.isAvailable = response.status === 200;
      return this.isAvailable;
    } catch (error) {
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Obtenir les statistiques d'usage (pour monitoring)
   */
  getUsageStats() {
    return {
      name: this.name,
      dailyQuota: 10000,
      monthlyCost: 0,
      isAvailable: this.isAvailable,
      features: [
        'Données ECMWF',
        'Pas de clé API',
        '10k appels/jour',
        'Couverture mondiale',
        'Géocodage gratuit'
      ]
    };
  }
}

export default OpenMeteoService;