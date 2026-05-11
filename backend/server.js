// server.js - Backend with weather API and grid calculations
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || 'YOUR_API_KEY_HERE';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper: Calculate solar power (Watts) based on cloud coverage
function calculateSolarPower(cloudsPercent, temp) {
  // Base solar power on clear sky: 3500W
  // Cloud factor: 1.0 at 0% clouds, 0.1 at 100% clouds
  const cloudFactor = Math.max(0.1, 1.0 - (cloudsPercent / 100) * 0.9);
  // Temperature factor: slightly reduced above 35°C
  const tempFactor = temp > 35 ? 0.9 : 1.0;
  return Math.round(3500 * cloudFactor * tempFactor);
}

// Helper: Calculate wind power (Watts) based on wind speed (m/s)
function calculateWindPower(windSpeed) {
  // Cubic relationship: P = 0.5 * air density * swept area * Cp * v^3
  // Simplified: at 5m/s -> 500W, at 10m/s -> 1500W, at 15m/s -> 3000W
  if (windSpeed < 2) return 0;
  let power = Math.min(3500, Math.round(12 * Math.pow(windSpeed, 2.5)));
  return power;
}

// Get weather and forecast from OpenWeatherMap
async function getWeatherData(city) {
  try {
    // Current weather
    const currentRes = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${OPENWEATHER_API_KEY}`
    );
    
    // 5-day forecast (3-hour intervals)
    const forecastRes = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=metric&appid=${OPENWEATHER_API_KEY}`
    );

    const current = currentRes.data;
    const temp = current.main.temp;
    const weatherDesc = current.weather[0].description;
    const clouds = current.clouds.all;
    const windSpeed = current.wind.speed;
    
    const solarPower = calculateSolarPower(clouds, temp);
    const windPower = calculateWindPower(windSpeed);
    
    // Process next 8 hours of forecast (first 3 intervals of 3 hours each = 9h, but we take 3)
    // Actually 8 hours = 2-3 intervals, we'll take 3 intervals (9h) for safety
    const next8hForecast = forecastRes.data.list.slice(0, 3).map(item => ({
      timestamp: item.dt,
      dt_txt: item.dt_txt,
      temp: item.main.temp,
      weather: item.weather[0].main,
      description: item.weather[0].description,
      clouds: item.clouds.all,
      windSpeed: item.wind.speed,
      solarPower: calculateSolarPower(item.clouds.all, item.main.temp),
      windPower: calculateWindPower(item.wind.speed)
    }));
    
    // Detect if there's a transition from sunny/clear to cloudy within next 8 hours
    const sunnyConditions = ['Clear', 'Sunny'];
    const cloudyConditions = ['Clouds', 'Overcast', 'Mist', 'Fog'];
    let hasSunnyToCloudy = false;
    let transitionHour = null;
    
    const currentSky = current.weather[0].main;
    if (sunnyConditions.includes(currentSky)) {
      for (let i = 0; i < next8hForecast.length; i++) {
        if (cloudyConditions.includes(next8hForecast[i].weather)) {
          hasSunnyToCloudy = true;
          transitionHour = i + 1; // hours from now
          break;
        }
      }
    }
    
    return {
      success: true,
      city: city,
      temperature: Math.round(temp),
      description: weatherDesc,
      clouds: clouds,
      windSpeed: windSpeed,
      solarPower: solarPower,
      windPower: windPower,
      totalGeneration: solarPower + windPower,
      forecast: next8hForecast,
      hasSunnyToCloudy: hasSunnyToCloudy,
      transitionHour: transitionHour,
      currentWeather: current.weather[0].main
    };
  } catch (error) {
    console.error('Weather API error:', error.message);
    if (error.response?.status === 401) {
      return { success: false, error: 'Invalid API key. Please set a valid OpenWeatherMap API key in .env file' };
    }
    if (error.response?.status === 404) {
      return { success: false, error: 'City not found. Please enter a valid city name' };
    }
    return { success: false, error: 'Failed to fetch weather data. Please check your connection' };
  }
}

// API endpoint for weather
app.get('/api/weather', async (req, res) => {
  const { city } = req.query;
  if (!city) {
    return res.status(400).json({ success: false, error: 'City parameter required' });
  }
  const data = await getWeatherData(city);
  res.json(data);
});

// API endpoint for grid simulation (optional backend validation)
app.post('/api/simulate', (req, res) => {
  const { solarPower, windPower, batteryCapacityWh, wireCapacityW, loadPower } = req.body;
  // Simple validation and calculation
  const totalGeneration = solarPower + windPower;
  const netPower = totalGeneration - loadPower;
  const isOverflow = netPower > 0;
  const overflowAmount = isOverflow ? netPower : 0;
  const underflowAmount = !isOverflow ? Math.abs(netPower) : 0;
  
  res.json({
    totalGeneration,
    netPower,
    isOverflow,
    overflowAmount,
    underflowAmount,
    canCharge: isOverflow,
    canDischarge: !isOverflow
  });
});

app.listen(PORT, () => {
  console.log(`Smart Grid Optimizer running on http://localhost:${PORT}`);
  console.log('Make sure to set OPENWEATHER_API_KEY in .env file');
});