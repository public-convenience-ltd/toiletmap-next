import { useEffect, useRef, useState } from "preact/hooks";

/** Where the viewer is, from the browser's geolocation. */
export interface UserLocation {
  lat: number;
  lng: number;
  /** Radius of uncertainty in metres, when the browser reports one. */
  accuracy?: number;
}

export const GEOLOCATION_UNSUPPORTED = "Your browser can't share your location.";
export const GEOLOCATION_DENIED =
  "Location access is blocked. Allow it in your browser settings, or search for a place.";
export const GEOLOCATION_FAILED =
  "We couldn't find your location. Try again, or search for a place.";

/** The message for a geolocation error (code 1 is PERMISSION_DENIED). */
export function geolocationErrorMessage(error: { code?: number } | null | undefined): string {
  return error?.code === 1 ? GEOLOCATION_DENIED : GEOLOCATION_FAILED;
}

/** A usable fix from a GeolocationPosition, or null. */
export function toUserLocation(position: {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
}): UserLocation | null {
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    lat: latitude,
    lng: longitude,
    ...(typeof accuracy === "number" && Number.isFinite(accuracy) ? { accuracy } : {}),
  };
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 30_000,
  timeout: 20_000,
};

/**
 * Tracks the viewer's location once they ask for it ("Find a toilet near me"): the first call
 * to `locate` starts watching (so the "you are here" dot follows them and the panel can show
 * distances), and each call hands the next fix — or the current one, if already known — to
 * its `onFix` (to centre the map). Nothing is requested until `locate` is called.
 */
export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locationRef = useRef<UserLocation | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const onNextFixRef = useRef<((location: UserLocation) => void) | null>(null);

  useEffect(
    () => () => {
      if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    },
    [],
  );

  const locate = (onFix?: (location: UserLocation) => void) => {
    setError(null);
    const geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geolocation) {
      setError(GEOLOCATION_UNSUPPORTED);
      return;
    }
    if (locationRef.current && watchIdRef.current !== null) {
      onFix?.(locationRef.current);
      return;
    }
    onNextFixRef.current = onFix ?? null;
    if (watchIdRef.current !== null) return;
    watchIdRef.current = geolocation.watchPosition(
      (position) => {
        const fix = toUserLocation(position);
        if (!fix) return;
        locationRef.current = fix;
        setLocation(fix);
        setError(null);
        const next = onNextFixRef.current;
        onNextFixRef.current = null;
        next?.(fix);
      },
      (positionError) => {
        onNextFixRef.current = null;
        // Denied: stop asking. Otherwise keep the last fix (if any) and keep watching.
        if (positionError.code === 1 || !locationRef.current) {
          if (watchIdRef.current !== null) geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
          locationRef.current = null;
          setLocation(null);
          setError(geolocationErrorMessage(positionError));
        }
      },
      WATCH_OPTIONS,
    );
  };

  return { location, error, locate };
}
