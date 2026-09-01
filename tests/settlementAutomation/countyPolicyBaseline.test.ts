import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COUNTY_BUILDING_ROLES,
  COUNTY_BUILD_POLICY_VERSION,
  COUNTY_ROAD_ROLES,
  COUNTY_STREET_STYLES,
} from "../../src/generation/countyBuild";

describe("SN-0 county policy baseline", () => {
  it("owns the translated orchestration policy inside the repository", async () => {
    const path = fileURLToPath(new URL("../fixtures/settlement-network/county-policy-v1.json", import.meta.url));
    const fixture = JSON.parse(await readFile(path, "utf8")) as {
      readonly policy_version: number;
      readonly growing_network: boolean;
      readonly street_styles: readonly string[];
      readonly road_roles: readonly string[];
      readonly building_roles: readonly string[];
      readonly backbone: { readonly legs: number; readonly straight_fallback: boolean };
      readonly translation: { readonly acceptance: string };
    };
    expect(fixture.policy_version).toBe(COUNTY_BUILD_POLICY_VERSION);
    expect(fixture.growing_network).toBe(true);
    expect(fixture.street_styles).toEqual(COUNTY_STREET_STYLES);
    expect(fixture.road_roles).toEqual(COUNTY_ROAD_ROLES);
    expect(fixture.building_roles).toEqual(COUNTY_BUILDING_ROLES);
    expect(fixture.backbone).toMatchObject({ legs: 2, straight_fallback: false });
    expect(fixture.translation.acceptance).toContain("one atomic bake");
  });
});
