import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
export function weatherLabel(code: number | null) { if (code === null) return '天気状態未提供'; if (code <= 1) return '晴れ'; if (code === 2) return '晴れ時々くもり'; if (code === 3) return 'くもり'; if (code <= 48) return '霧'; if (code <= 57) return '霧雨'; if (code <= 67 || code >= 80 && code <= 82) return '雨'; if (code < 95) return '雪'; return '雷雨'; }
export function WeatherIcon({ code, size = 28, className = '' }: { code: number | null; size?: number; className?: string }) {
  const Icon = code === null ? Cloud : code <= 1 ? Sun : code === 2 ? CloudSun : code === 3 ? Cloud : code <= 48 ? CloudFog : code <= 57 ? CloudDrizzle : code <= 67 || code >= 80 && code <= 82 ? CloudRain : code < 95 ? CloudSnow : CloudLightning;
  return <Icon size={size} strokeWidth={1.5} className={`weather-icon ${className}`} aria-hidden="true"/>;
}
