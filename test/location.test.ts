import { describe, it, expect } from "bun:test";
import { isUsLocation, isUsJob, isNonUsJob } from "../src/location.ts";

describe("location classification", () => {
  it("recognizes standard US cities with state codes", () => {
    expect(isUsLocation("San Francisco, CA")).toBe(true);
    expect(isUsLocation("Austin, TX")).toBe(true);
    expect(isUsLocation("New York, NY")).toBe(true);
    expect(isUsLocation("Seattle, WA")).toBe(true);
    expect(isUsLocation("Chicago, IL")).toBe(true);
    expect(isUsLocation("Boston, MA")).toBe(true);
    expect(isUsLocation("Atlanta, GA")).toBe(true);
    expect(isUsLocation("North Wales, PA")).toBe(true);
  });

  it("recognizes US shorthand cities and tech hubs", () => {
    expect(isUsLocation("SF")).toBe(true);
    expect(isUsLocation("NYC")).toBe(true);
    expect(isUsLocation("LA")).toBe(true);
    expect(isUsLocation("Bay Area")).toBe(true);
    expect(isUsLocation("Silicon Valley")).toBe(true);
  });

  it("recognizes US country keywords and remote variations", () => {
    expect(isUsLocation("United States")).toBe(true);
    expect(isUsLocation("USA")).toBe(true);
    expect(isUsLocation("U.S.A.")).toBe(true);
    expect(isUsLocation("Remote in USA")).toBe(true);
    expect(isUsLocation("Remote (US)")).toBe(true);
    expect(isUsLocation("US Remote")).toBe(true);
    expect(isUsLocation("Remote")).toBe(true);
  });

  it("recognizes full US state names and avoids false-positive country matches", () => {
    expect(isUsLocation("New Mexico")).toBe(true);
    expect(isUsLocation("Indiana")).toBe(true);
    expect(isUsLocation("California")).toBe(true);
    expect(isUsLocation("Texas")).toBe(true);
    expect(isUsLocation("Washington")).toBe(true);
  });

  it("identifies non-US locations correctly", () => {
    expect(isUsLocation("Manchester, UK")).toBe(false);
    expect(isUsLocation("London, UK")).toBe(false);
    expect(isUsLocation("Edinburgh, UK")).toBe(false);
    expect(isUsLocation("Oxford, UK")).toBe(false);
    expect(isUsLocation("Toronto, ON, Canada")).toBe(false);
    expect(isUsLocation("Calgary, AB, Canada")).toBe(false);
    expect(isUsLocation("Vancouver, BC, Canada")).toBe(false);
    expect(isUsLocation("Berlin, Germany")).toBe(false);
    expect(isUsLocation("Paris, France")).toBe(false);
    expect(isUsLocation("Dublin, Ireland")).toBe(false);
    expect(isUsLocation("Bengaluru, India")).toBe(false);
    expect(isUsLocation("Sydney, Australia")).toBe(false);
    expect(isUsLocation("Remote (EMEA)")).toBe(false);
    expect(isUsLocation("Remote (APAC)")).toBe(false);
    expect(isUsLocation("Remote in Canada")).toBe(false);
  });

  it("evaluates isUsJob and isNonUsJob on multi-location jobs", () => {
    // US only
    expect(isUsJob({ locations: ["San Francisco, CA"] })).toBe(true);
    expect(isNonUsJob({ locations: ["San Francisco, CA"] })).toBe(false);

    // Non-US only
    expect(isUsJob({ locations: ["London, UK", "Manchester, UK"] })).toBe(false);
    expect(isNonUsJob({ locations: ["London, UK", "Manchester, UK"] })).toBe(true);

    // Multi-location with both US and non-US
    expect(isUsJob({ locations: ["London, UK", "New York, NY"] })).toBe(true);
    expect(isNonUsJob({ locations: ["London, UK", "New York, NY"] })).toBe(false);

    // Empty locations default to permissive
    expect(isUsJob({ locations: [] })).toBe(true);
    expect(isNonUsJob({ locations: [] })).toBe(false);
  });
});
