export type ThemeMode = "manual" | "system" | "schedule" | "sunset";
export type ThemePhase = "light" | "dark";

export interface GeoLocation {
  lat: number;
  lng: number;
  label: string;
  source: "geo" | "manual";
}

export interface AutomationConfig {
  mode: ThemeMode;
  scheduleLightStart: string; // "HH:MM"
  scheduleDarkStart: string; // "HH:MM"
  location: GeoLocation | null;
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isLightBySchedule(nowMin: number, lightStart: number, darkStart: number): boolean {
  if (lightStart === darkStart) return true;
  if (lightStart < darkStart) return nowMin >= lightStart && nowMin < darkStart;
  return nowMin >= lightStart || nowMin < darkStart;
}

// Sunrise/sunset via the standard sunrise equation (NOAA-derived).
// Returns absolute Date instants (UTC-correct); phase comparisons are timezone-agnostic.
export function sunTimes(date: Date, lat: number, lng: number): { sunrise: Date; sunset: Date } {
  const rad = Math.PI / 180;
  const J2000 = 2451545.0;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = Math.round(jd - J2000 - 0.0009 + lng / 360);
  const jStar = n + 0.0009 - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const Mr = M * rad;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = ((M + C + 180 + 102.9372) % 360) * rad;
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
  const declSin = Math.sin(lambda) * Math.sin(23.44 * rad);
  const decl = Math.asin(declSin);
  const cosOmega =
    (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) /
    (Math.cos(lat * rad) * Math.cos(decl));
  const jdToDate = (j: number) => new Date((j - 2440587.5) * 86400000);
  // Polar day/night: sun never crosses the horizon.
  if (cosOmega < -1) {
    // Sun always up → treat whole day as light.
    return { sunrise: jdToDate(jTransit - 0.5), sunset: jdToDate(jTransit + 0.5) };
  }
  if (cosOmega > 1) {
    // Sun always down → collapse the light window to nothing.
    return { sunrise: jdToDate(jTransit), sunset: jdToDate(jTransit) };
  }
  const omega = Math.acos(cosOmega) / rad;
  const jSet = jTransit + omega / 360;
  const jRise = jTransit - omega / 360;
  return { sunrise: jdToDate(jRise), sunset: jdToDate(jSet) };
}

export function resolveThemePhase(
  cfg: AutomationConfig,
  now: Date,
  systemPrefersDark: boolean,
): ThemePhase {
  switch (cfg.mode) {
    case "manual":
      return "light"; // unused — effective id uses activeThemeId in manual mode
    case "system":
      return systemPrefersDark ? "dark" : "light";
    case "schedule": {
      const l = parseHHMM(cfg.scheduleLightStart);
      const d = parseHHMM(cfg.scheduleDarkStart);
      if (l === null || d === null) return "light";
      return isLightBySchedule(minutesOfDay(now), l, d) ? "light" : "dark";
    }
    case "sunset": {
      if (!cfg.location) return systemPrefersDark ? "dark" : "light";
      const { sunrise, sunset } = sunTimes(now, cfg.location.lat, cfg.location.lng);
      return now.getTime() >= sunrise.getTime() && now.getTime() < sunset.getTime()
        ? "light"
        : "dark";
    }
  }
}

export function nextTransition(
  cfg: AutomationConfig,
  now: Date,
  _systemPrefersDark: boolean,
): Date | null {
  if (cfg.mode === "manual" || cfg.mode === "system") return null;

  if (cfg.mode === "schedule") {
    const l = parseHHMM(cfg.scheduleLightStart);
    const d = parseHHMM(cfg.scheduleDarkStart);
    if (l === null || d === null || l === d) return null;
    const candidates = [l, d].map((min) => {
      const t = new Date(now);
      t.setHours(Math.floor(min / 60), min % 60, 0, 0);
      if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
      return t;
    });
    return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
  }

  // sunset
  if (!cfg.location) return null;
  const today = sunTimes(now, cfg.location.lat, cfg.location.lng);
  const upcoming = [today.sunrise, today.sunset].filter((t) => t.getTime() > now.getTime());
  if (upcoming.length > 0) return upcoming.sort((a, b) => a.getTime() - b.getTime())[0];
  const tomorrow = sunTimes(new Date(now.getTime() + 86400000), cfg.location.lat, cfg.location.lng);
  return tomorrow.sunrise;
}
