/**
 * Location classification utilities for US vs Non-US detection.
 */

export const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "GU", "VI", "AS", "MP",
]);

export const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming", "district of columbia", "puerto rico",
]);

const NON_US_COUNTRIES_AND_REGIONS = [
  "uk", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland",
  "canada", "germany", "deutschland", "france", "india", "australia",
  "ireland", "netherlands", "spain", "switzerland", "sweden", "poland",
  "italy", "brazil", "mexico", "israel", "singapore", "japan", "china",
  "taiwan", "south korea", "korea", "new zealand", "denmark", "norway",
  "finland", "austria", "belgium", "portugal", "czech republic", "czechia",
  "romania", "hungary", "greece", "south africa", "argentina", "chile",
  "colombia", "philippines", "vietnam", "indonesia", "malaysia", "uae",
  "united arab emirates", "egypt", "nigeria", "kenya", "turkey", "pakistan",
  "emea", "apac", "latam", "europe",
];

const NON_US_CITIES = [
  "london", "manchester", "edinburgh", "oxford", "cambridge, uk", "bristol", "birmingham",
  "leeds", "glasgow", "dublin", "toronto", "vancouver, bc", "montreal", "ottawa", "waterloo",
  "calgary", "berlin", "munich", "frankfurt", "paris", "amsterdam", "madrid", "barcelona",
  "stockholm", "zurich", "geneva", "warsaw", "bengaluru", "bangalore", "hyderabad", "pune",
  "mumbai", "delhi", "gurgaon", "noida", "chennai", "sydney", "melbourne", "brisbane",
  "tokyo", "beijing", "shanghai", "shenzhen", "tel aviv", "sao paulo",
];

/**
 * Evaluates whether a location string corresponds to a US location.
 */
export function isUsLocation(raw: string): boolean {
  if (!raw) return false;
  const loc = raw.trim();
  const lower = loc.toLowerCase();

  // 1. Explicit US state names that contain substrings of other countries (e.g. New Mexico, Indiana)
  if (lower === "new mexico" || /\bnew mexico\b/i.test(loc)) return true;
  if (lower === "indiana" || /\bindiana\b/i.test(loc)) return true;

  // 2. Locations ending with a standard US state abbreviation after comma, e.g. "North Wales, PA", "San Francisco, CA"
  const endsWithUsState = loc.match(/,\s*([A-Za-z]{2})(?:\s*\(.*?\))?\s*$/);
  if (endsWithUsState && US_STATE_CODES.has(endsWithUsState[1].toUpperCase())) {
    return true;
  }

  // 3. Explicit Non-US indicators (e.g. ", UK", ", Canada", "London, UK", "Toronto, ON, Canada")
  for (const country of NON_US_COUNTRIES_AND_REGIONS) {
    if (new RegExp(`(?:^|[,/\\-\\s])${country}(?:\\s*\\(.*\\)|\\s*$|[\\s,/\\-])`, "i").test(loc)) {
      return false;
    }
  }

  // Check known international cities listed standalone
  for (const city of NON_US_CITIES) {
    if (new RegExp(`(?:^|[,/\\-\\s])${city}(?:$|[,/\\-\\s])`, "i").test(loc)) {
      return false;
    }
  }

  // 4. Explicit US country keywords
  if (/\b(usa|united states|u\.s\.a?\.?)\b/i.test(loc)) return true;
  if (/^remote\s*(in\s*)?usa?$/i.test(loc)) return true;
  if (/^remote\s*\(?us\)?$/i.test(loc)) return true;
  if (/^us\s*remote$/i.test(loc)) return true;

  // 5. Known US city shorthand
  if (/^(sf|nyc|la|bay area|silicon valley)$/i.test(loc)) return true;

  // 6. US State 2-letter abbreviation after comma anywhere: e.g. "San Francisco, CA (Hybrid)"
  const stateMatch = loc.match(/,\s*([A-Za-z]{2})(?:\s|$|,|\()/);
  if (stateMatch && US_STATE_CODES.has(stateMatch[1].toUpperCase())) {
    return true;
  }

  // 7. Full US state name
  if (US_STATE_NAMES.has(lower)) return true;
  for (const name of US_STATE_NAMES) {
    if (new RegExp(`(?:^|[,\\s])${name}(?:$|[,\\s])`, "i").test(loc)) {
      return true;
    }
  }

  // 8. Common major US cities when listed without state
  if (
    /^(san francisco|new york( city)?|los angeles|seattle|chicago|austin|boston|atlanta|san jose|san diego|dallas|houston|philadelphia|denver|salt lake city|pittsburgh)$/i.test(
      loc,
    )
  ) {
    return true;
  }

  // 9. Generic "Remote" without country
  if (/^remote$/i.test(loc)) return true;

  return false;
}

/**
 * Checks if a job has at least one US location (or remote).
 * If locations array is empty, returns true (permissive for unlabelled jobs).
 */
export function isUsJob(job: { locations?: string[] }): boolean {
  if (!job.locations || job.locations.length === 0) return true;
  return job.locations.some((loc) => isUsLocation(loc));
}

/**
 * Checks if a job is strictly non-US (has locations and NONE are US).
 */
export function isNonUsJob(job: { locations?: string[] }): boolean {
  return !isUsJob(job);
}
