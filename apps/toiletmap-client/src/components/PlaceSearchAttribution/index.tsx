const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

interface PlaceSearchAttributionProps {
  /** The attribution `/api/geocode` sent with the results, or null when none is needed. */
  attribution: string | null;
  class?: string;
}

/**
 * The credit place-search results must carry: OpenStreetMap's (ODbL) for
 * Nominatim results, linked to its copyright page. Renders nothing for
 * results that need none (postcodes.io).
 */
export default function PlaceSearchAttribution({
  attribution,
  class: className,
}: PlaceSearchAttributionProps) {
  if (!attribution) return null;
  if (!attribution.includes("OpenStreetMap")) return <p class={className}>{attribution}</p>;
  return (
    <p class={className}>
      Search results ©{" "}
      <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
        OpenStreetMap
      </a>{" "}
      contributors (ODbL)
    </p>
  );
}
