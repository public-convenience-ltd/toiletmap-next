import { describe, expect, it } from "vitest";
import { MAX_DIRECT_MOVE_METRES, SERVICE_AREA_BOUNDS } from "../../src/common/constants";
import {
  createMutationSchema,
  idsQuerySchema,
  looIdParamSchema,
  looIdSchema,
  proximitySchema,
  updateMutationSchema,
} from "../../src/routes/loos/schemas";
import {
  checkNonAdminFields,
  checkNonAdminLocation,
  isLargeMove,
  isWithinServiceArea,
} from "../../src/routes/loos/write-guards";

describe("isWithinServiceArea (GB, NI, Isle of Man, Channel Islands)", () => {
  it.each([
    ["central London", 51.5072, -0.1276],
    ["Muckle Flugga, Shetland (most northerly)", 60.855, -0.885],
    ["Hirta, St Kilda (most westerly in GB)", 57.81, -8.58],
    ["Belleek, County Fermanagh (west of NI)", 54.478, -8.09],
    ["Ness Point, Lowestoft (most easterly)", 52.4815, 1.7629],
    ["St Mary's, Isles of Scilly", 49.914, -6.311],
    ["Douglas, Isle of Man", 54.15, -4.48],
    ["St Helier, Jersey", 49.186, -2.106],
    ["St Peter Port, Guernsey", 49.455, -2.536],
    ["Alderney", 49.714, -2.198],
    ["Les Minquiers (most southerly)", 48.97, -2.13],
  ])("accepts %s", (_place, lat, lng) => {
    expect(isWithinServiceArea({ lat, lng })).toBe(true);
  });

  it.each([
    ["0,0 (null island)", 0, 0],
    ["swapped London coordinates", -0.1276, 51.5072],
    ["Paris", 48.8566, 2.3522],
    ["Amsterdam", 52.3676, 4.9041],
    ["New York", 40.7128, -74.006],
    ["north of Shetland", 61.2, -1],
  ])("refuses %s", (_place, lat, lng) => {
    expect(isWithinServiceArea({ lat, lng })).toBe(false);
  });

  it("includes the box's edges and refuses non-finite values", () => {
    const { minLat, maxLat, minLng, maxLng } = SERVICE_AREA_BOUNDS;
    expect(isWithinServiceArea({ lat: minLat, lng: minLng })).toBe(true);
    expect(isWithinServiceArea({ lat: maxLat, lng: maxLng })).toBe(true);
    expect(isWithinServiceArea({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isWithinServiceArea({ lat: 52, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("checkNonAdminFields", () => {
  it("allows ordinary edits", () => {
    expect(checkNonAdminFields({ name: "Park", notes: null, location: { lat: 51, lng: 0 } })).toBe(
      null,
    );
  });

  it.each([
    ["active", { active: false }],
    ["active even when true", { active: true }],
    ["removalReason", { removalReason: "Gone" }],
    ["removalReason null", { removalReason: null }],
  ])("refuses %s with admin_only_fields", (_label, mutation) => {
    const refusal = checkNonAdminFields(mutation);
    expect(refusal?.error).toBe("admin_only_fields");
    const field = Object.keys(mutation)[0] ?? "";
    expect(refusal?.issues[field]).toEqual({ _errors: [`${field} can only be set by an admin`] });
  });

  it("refuses clearing the location with location_required", () => {
    expect(checkNonAdminFields({ location: null })?.error).toBe("location_required");
  });
});

describe("checkNonAdminLocation", () => {
  it("allows no location, or one inside the area", () => {
    expect(checkNonAdminLocation(undefined)).toBe(null);
    expect(checkNonAdminLocation({ lat: 53.48, lng: -2.24 })).toBe(null);
  });

  it("refuses a location outside the area, keyed to the location field", () => {
    const refusal = checkNonAdminLocation({ lat: 48.8566, lng: 2.3522 });
    expect(refusal?.error).toBe("location_out_of_area");
    expect(refusal?.issues.location).toBeDefined();
  });
});

describe("isLargeMove", () => {
  const from = { lat: 51.5, lng: -0.12 };
  // One degree of latitude is about 111 km, so 0.0001° is about 11 m.
  const north = (metres: number) => ({ lat: from.lat + metres / 111_195, lng: from.lng });

  it(`is false up to ${MAX_DIRECT_MOVE_METRES} m and true beyond`, () => {
    expect(isLargeMove(from, north(10))).toBe(false);
    expect(isLargeMove(from, north(MAX_DIRECT_MOVE_METRES - 1))).toBe(false);
    expect(isLargeMove(from, north(MAX_DIRECT_MOVE_METRES + 1))).toBe(true);
    expect(isLargeMove(from, north(5000))).toBe(true);
  });

  it("does not count placing an unlocated toilet, or no change, as a move", () => {
    expect(isLargeMove(null, north(5000))).toBe(false);
    expect(isLargeMove(from, undefined)).toBe(false);
  });
});

describe("the shared loo id schema", () => {
  const id = "0123456789abcdef01234567";

  it("accepts 24 hex characters and lowercases them", () => {
    expect(looIdSchema.parse(id)).toBe(id);
    expect(looIdSchema.parse(` ${id.toUpperCase()} `)).toBe(id);
  });

  it.each([
    ["23 characters", id.slice(1)],
    ["25 characters", `${id}0`],
    ["a non-hex character", `${id.slice(0, 23)}g`],
    ["a LIKE wildcard", `${id.slice(0, 23)}%`],
  ])("refuses %s", (_label, value) => {
    expect(looIdSchema.safeParse(value).success).toBe(false);
  });

  it("is used for path ids, ?ids=, exclude, body ids, areaId and duplicateOf", () => {
    const bad = "zzzzzzzzzzzzzzzzzzzzzzzz";
    expect(looIdParamSchema.safeParse({ id: bad }).success).toBe(false);
    expect(idsQuerySchema.safeParse({ ids: `${id},${bad}` }).success).toBe(false);
    expect(idsQuerySchema.parse({ ids: id.toUpperCase() }).ids).toEqual([id]);
    expect(proximitySchema.safeParse({ lat: "51", lng: "0", exclude: bad }).success).toBe(false);
    expect(createMutationSchema.safeParse({ id: bad }).success).toBe(false);
    expect(updateMutationSchema.safeParse({ areaId: bad }).success).toBe(false);
  });
});

describe("mutation coordinates", () => {
  it("must be finite and within the WGS84 ranges", () => {
    expect(updateMutationSchema.safeParse({ location: { lat: 51, lng: 0 } }).success).toBe(true);
    for (const location of [
      { lat: 91, lng: 0 },
      { lat: 51, lng: -181 },
      { lat: Number.POSITIVE_INFINITY, lng: 0 },
      { lat: 51, lng: Number.NaN },
    ]) {
      expect(updateMutationSchema.safeParse({ location }).success).toBe(false);
    }
  });

  it("refuses removalCategory and duplicateOf from every caller (report and restore set them)", () => {
    expect(updateMutationSchema.safeParse({ removalCategory: "other" }).success).toBe(false);
    expect(createMutationSchema.safeParse({ duplicateOf: "0".repeat(24) }).success).toBe(false);
  });
});
