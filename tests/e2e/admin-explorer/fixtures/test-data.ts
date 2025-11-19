/**
 * Test data generators for admin-explorer E2E tests
 */

export interface LooTestData {
  name: string;
  location?: {
    lat: number;
    lng: number;
  };
  active?: boolean | null;
  accessible?: boolean | null;
  allGender?: boolean | null;
  attended?: boolean | null;
  automatic?: boolean | null;
  babyChange?: boolean | null;
  children?: boolean | null;
  men?: boolean | null;
  women?: boolean | null;
  radar?: boolean | null;
  urinalOnly?: boolean | null;
  noPayment?: boolean | null;
  paymentDetails?: string | null;
  notes?: string | null;
  removalReason?: string | null;
  openingTimes?: (string[] | [])[];
}

/**
 * Generate a valid loo object for testing
 */
export function generateValidLoo(overrides?: Partial<LooTestData>): LooTestData {
  return {
    name: 'Test Loo ' + Date.now(),
    location: {
      lat: 51.5074,
      lng: -0.1278,
    },
    active: true,
    accessible: true,
    allGender: null,
    attended: false,
    automatic: false,
    babyChange: true,
    children: null,
    men: true,
    women: true,
    radar: false,
    urinalOnly: false,
    noPayment: true,
    paymentDetails: null,
    notes: 'Test notes',
    removalReason: null,
    openingTimes: null,
    ...overrides,
  };
}

/**
 * Generate loo with opening hours
 */
export function generateLooWithOpeningHours(): LooTestData {
  return generateValidLoo({
    openingTimes: [
      ['09:00', '17:00'], // Monday
      ['09:00', '17:00'], // Tuesday
      ['09:00', '17:00'], // Wednesday
      ['09:00', '17:00'], // Thursday
      ['09:00', '17:00'], // Friday
      [], // Saturday - closed
      [], // Sunday - closed
    ],
  });
}

/**
 * Generate loo with payment details
 */
export function generateLooWithPayment(): LooTestData {
  return generateValidLoo({
    noPayment: false,
    paymentDetails: '20p',
  });
}

/**
 * Generate loo at edge location (near date line)
 */
export function generateLooAtDateLine(): LooTestData {
  return generateValidLoo({
    name: 'Date Line Test Loo',
    location: {
      lat: 0,
      lng: 179.999,
    },
  });
}

/**
 * Generate loo at north pole
 */
export function generateLooAtNorthPole(): LooTestData {
  return generateValidLoo({
    name: 'North Pole Test Loo',
    location: {
      lat: 89.999,
      lng: 0,
    },
  });
}

/**
 * Generate loo with special characters in name
 */
export function generateLooWithSpecialChars(): LooTestData {
  return generateValidLoo({
    name: 'Test <script>alert("xss")</script> Loo',
    notes: 'Special chars: é, ñ, ü, 中文, 🚽',
  });
}

/**
 * Generate loo with maximum length fields
 */
export function generateLooWithMaxLengthFields(): LooTestData {
  return generateValidLoo({
    name: 'A'.repeat(200),
    notes: 'N'.repeat(1000),
    paymentDetails: 'P'.repeat(200),
  });
}

/**
 * Invalid test data for validation testing
 */
export const invalidTestData = {
  noName: {
    name: '',
    location: { lat: 51.5074, lng: -0.1278 },
  },
  invalidLatitude: {
    name: 'Invalid Lat Loo',
    location: { lat: 91, lng: 0 }, // > 90
  },
  invalidLongitude: {
    name: 'Invalid Lng Loo',
    location: { lat: 0, lng: 181 }, // > 180
  },
  missingLatitude: {
    name: 'Missing Lat Loo',
    location: { lat: null as any, lng: -0.1278 },
  },
  missingLongitude: {
    name: 'Missing Lng Loo',
    location: { lat: 51.5074, lng: null as any },
  },
  invalidOpeningHours: {
    name: 'Invalid Hours Loo',
    // Open time after close time
    openingTimes: [
      ['17:00', '09:00'], // Invalid
      [], [], [], [], [], [],
    ],
  },
  noPaymentDetailsWhenPaid: {
    name: 'No Payment Details Loo',
    noPayment: false,
    paymentDetails: null, // Should be required when noPayment is false
  },
};

/**
 * Common test search queries
 */
export const searchQueries = {
  valid: 'Test',
  noResults: 'ThisWillNeverMatchAnything12345',
  specialChars: '<script>',
  unicode: '中文',
  emoji: '🚽',
};

/**
 * Helper to wait for a specific duration
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
