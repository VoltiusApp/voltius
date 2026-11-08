import { useEffect, useState } from "react";
import { locationSetting, useThemeStore } from "@/stores/themeStore";
import { usePolicyLock } from "@/stores/policyStore";

const parse = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function useLocationFields() {
  const location = locationSetting.use();
  const setLocation = useThemeStore((s) => s.setLocation);
  const locked = usePolicyLock("themes.location").locked;
  const [latText, setLatText] = useState(location ? String(location.lat) : "");
  const [lngText, setLngText] = useState(location ? String(location.lng) : "");
  const [geoBusy, setGeoBusy] = useState(false);

  useEffect(() => {
    if (!location) return;
    if (parse(latText) !== location.lat || parse(lngText) !== location.lng) {
      setLatText(String(location.lat));
      setLngText(String(location.lng));
    }
  }, [location?.lat, location?.lng]);

  const typed = (lat: string, lng: string) => {
    setLatText(lat);
    setLngText(lng);
    const [a, b] = [parse(lat), parse(lng)];
    if (Number.isFinite(a) && Number.isFinite(b)) setLocation({ lat: a, lng: b, label: "manual", source: "manual" });
  };

  const locateMe = (label: string) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label, source: "geo" });
        setLatText(String(pos.coords.latitude));
        setLngText(String(pos.coords.longitude));
        setGeoBusy(false);
      },
      () => setGeoBusy(false),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  return {
    location,
    locked,
    geoBusy,
    latText,
    lngText,
    setLat: (v: string) => typed(v, lngText),
    setLng: (v: string) => typed(latText, v),
    locateMe,
  };
}
