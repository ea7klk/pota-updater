export type Bbox = { south: number; west: number; north: number; east: number };

export const MAX_BBOX_AREA_KM2 = 20_000;

export function validBbox(bbox: Bbox) {
  return Number.isFinite(bbox.south) && Number.isFinite(bbox.west) && Number.isFinite(bbox.north) && Number.isFinite(bbox.east)
    && bbox.south >= -90 && bbox.north <= 90 && bbox.south < bbox.north && bbox.west >= -180 && bbox.east <= 180 && bbox.west < bbox.east;
}

export function bboxAreaKm2(bbox: Bbox) {
  const latRadians = Math.PI / 180;
  const height = (bbox.north - bbox.south) * 111.32;
  const meanLatitude = ((bbox.north + bbox.south) / 2) * latRadians;
  const width = (bbox.east - bbox.west) * 111.32 * Math.cos(meanLatitude);
  return Math.abs(width * height);
}
