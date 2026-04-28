import { getApiUrl } from "./config";

export interface LooDetail {
  id: string;
  name: string | null;
  location: { lat: number; lng: number } | null;
  accessible: boolean | null;
  allGender: boolean | null;
  men: boolean | null;
  women: boolean | null;
  children: boolean | null;
  babyChange: boolean | null;
  radar: boolean | null;
  automatic: boolean | null;
  noPayment: boolean | null;
  paymentDetails: string | null;
  openingTimes: ([string, string] | [])[] | null;
  updatedAt: string | null;
  [key: string]: unknown;
}

export async function getLooById(apiUrl: string, id: string): Promise<LooDetail | null> {
  try {
    const response = await fetch(getApiUrl(apiUrl, `/api/loos/${id}`));
    if (!response.ok) {
      console.error(`Failed to fetch loo ${id}: ${response.statusText}`);
      return null;
    }
    return (await response.json()) as LooDetail;
  } catch (error) {
    console.error("Error getting loo details:", error);
    return null;
  }
}

export async function getLoosByIds(apiUrl: string, ids: string[]): Promise<LooDetail[]> {
  if (!ids.length) return [];

  const results: LooDetail[] = [];
  const chunkSize = 50;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const params = new URLSearchParams();
    for (const id of chunk) params.append("ids", id);

    try {
      const response = await fetch(getApiUrl(apiUrl, `/api/loos?${params.toString()}`));
      if (response.ok) {
        const json = (await response.json()) as { data: LooDetail[] };
        results.push(...json.data);
      } else {
        console.error(`Failed to batch fetch loos: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error batch fetching loos:", error);
    }
  }

  return results;
}
