// matching.js
// Finds the nearest organization(s) to a report's location, using the
// Haversine formula to calculate real-world distance between two
// lat/lng points (accounts for the Earth's curvature — accurate enough
// for city-scale distances).

const db = require('../elder-rescue-backend-matching/db');

const EARTH_RADIUS_KM = 6371;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Distance in km between two lat/lng points
function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Returns all verified organizations within their own coverage radius
// of the given point, sorted nearest-first. Each result includes a
// distance_km field.
function findNearbyOrganizations(latitude, longitude) {
  const getOrgs = db.prepare('SELECT * FROM organizations WHERE verified = 1');
  const orgs = getOrgs.all();

  const withDistance = orgs.map((org) => ({
    ...org,
    distance_km: distanceKm(latitude, longitude, org.latitude, org.longitude),
  }));

  // Only keep orgs where the report falls within THAT org's stated coverage radius
  const inRange = withDistance.filter((org) => org.distance_km <= org.coverage_radius_km);

  inRange.sort((a, b) => a.distance_km - b.distance_km);

  return inRange;
}

module.exports = { distanceKm, findNearbyOrganizations };
