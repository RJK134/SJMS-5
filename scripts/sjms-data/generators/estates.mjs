/**
 * estates generator (D2)
 *
 * Future Horizons University estate:
 *   - 1 Campus
 *   - ~30 Buildings (academic teaching + admin + library + sports + service)
 *   - ~600 Rooms (lecture theatres, classrooms, labs, seminar rooms, offices)
 *   - 12 AccommodationHall (one per estate quarter)
 *   - ~3000 AccommodationRoom (single en-suite / shared / studio mix)
 *
 * Departments come from D2 governance — but estates runs FIRST in topological
 * order (no Room → Department FK enforcement here, the schema makes
 * Room.departmentId a String, not validated). For rooms we use a stable
 * placeholder department code; governance fixes the FK in its own pass by
 * publishing dept ids and we re-attribute. For D2 we keep it simple: rooms
 * point at the first 30-odd department codes as text. Strict referential
 * integrity is checked at importer time on the SJMS-5 side.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { FACULTIES, ALL_DEPARTMENTS, INSTITUTION } from '../lib/uk-uni-skeleton.mjs';

export const domain = 'estates';

const BUILDING_TYPES = [
  // (suffix, count, type, hasResearch)
  { kind: 'TEACHING',       suffix: 'Teaching Building',   count: 12 },
  { kind: 'RESEARCH',       suffix: 'Research Centre',     count: 6 },
  { kind: 'LIBRARY',        suffix: 'Library',             count: 1 },
  { kind: 'STUDENT_UNION',  suffix: "Students' Union",     count: 1 },
  { kind: 'SPORTS',         suffix: 'Sports Centre',       count: 1 },
  { kind: 'CATERING',       suffix: 'Refectory',           count: 2 },
  { kind: 'ADMIN',          suffix: 'Admin Building',      count: 3 },
  { kind: 'WORKSHOP',       suffix: 'Workshop & Lab',      count: 4 },
];

const ROOM_TYPES = [
  ['LECTURE_THEATRE',  120],
  ['CLASSROOM',         40],
  ['SEMINAR_ROOM',      20],
  ['LAB',               30],
  ['COMPUTER_LAB',      40],
  ['OFFICE',             2],
  ['STUDIO',            15],
  ['MEETING_ROOM',      10],
  ['BREAKOUT_SPACE',    25],
];

const HALL_NAMES = [
  'Beech', 'Birch', 'Cedar', 'Elm', 'Fir', 'Hawthorn',
  'Larch', 'Maple', 'Oak', 'Pine', 'Rowan', 'Willow',
];

const ACCOMMODATION_ROOM_TYPES = [
  // (code, sharePercent, price/term, hasEnsuite, capacity)
  { code: 'STUDIO',         pct: 0.15, price: 2400, ensuite: true,  capacity: 1 },
  { code: 'ENSUITE_SINGLE', pct: 0.50, price: 1900, ensuite: true,  capacity: 1 },
  { code: 'SHARED_BATH',    pct: 0.25, price: 1500, ensuite: false, capacity: 1 },
  { code: 'TWIN',           pct: 0.10, price: 1300, ensuite: false, capacity: 2 },
];

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const rng = ctx.rng.fork('estates');

  // 1. Campus
  const campusId = `campus-${INSTITUTION.shortName.toLowerCase()}-main`;
  ctx.ids.campusIds.push(campusId);
  ctx.append('Campus', [{
    id: campusId, ...ctx.audit(now),
    name: `${INSTITUTION.name} Main Campus`,
    code: 'MAIN',
    address: '1 University Way',
    city: INSTITUTION.city, postcode: 'FH1 1AA', country: 'United Kingdom',
  }]);

  // 2. Buildings
  const buildings = [];
  for (const bt of BUILDING_TYPES) {
    for (let i = 1; i <= bt.count; i++) {
      const code = `BLD-${bt.kind}-${i.toString().padStart(2, '0')}`;
      const id = `bld-${code.toLowerCase()}`;
      ctx.ids.buildingIds.push({ id, code, kind: bt.kind });
      buildings.push({
        id, ...ctx.audit(now),
        name: `${bt.suffix} ${i}`,
        code, campusId, address: `Building ${code}, ${INSTITUTION.city}`,
      });
    }
  }
  ctx.append('Building', buildings);

  // 3. Rooms — distribute across buildings; cycle through dept codes.
  const rooms = [];
  const teachingBuildings = ctx.ids.buildingIds.filter(b =>
    ['TEACHING','RESEARCH','WORKSHOP','LIBRARY'].includes(b.kind));
  for (const b of teachingBuildings) {
    const roomsInBuilding = rng.int(15, 40);
    for (let r = 0; r < roomsInBuilding; r++) {
      const [roomType, baseCapacity] = rng.pick(ROOM_TYPES);
      const capacity = Math.max(2, baseCapacity + rng.int(-5, 10));
      const dept = rng.pick(ALL_DEPARTMENTS);
      const roomNumber = `${b.code}-${(r + 1).toString().padStart(3, '0')}`;
      const id = `room-${roomNumber.toLowerCase()}`;
      ctx.ids.roomIds.push({ id, type: roomType, buildingId: b.id, capacity, code: roomNumber });
      rooms.push({
        id, ...ctx.audit(now),
        name: `Room ${roomNumber}`, code: roomNumber,
        buildingId: b.id, departmentId: `dept-${dept.code.toLowerCase()}`,
        capacity, roomType,
        hasProjector: roomType !== 'OFFICE' ? rng.chance(0.85) : false,
        hasWhiteboard: roomType !== 'OFFICE' ? rng.chance(0.9) : true,
        hasComputers: roomType === 'COMPUTER_LAB' || roomType === 'LAB' || rng.chance(0.15),
        notes: null,
      });
    }
  }
  ctx.append('Room', rooms);

  // 4. Accommodation halls (12)
  const halls = [];
  HALL_NAMES.forEach((name, i) => {
    const id = `hall-${name.toLowerCase()}`;
    halls.push({
      id, ...ctx.audit(now),
      name: `${name} Hall`, campusId,
      totalRooms: 0,                     // set below after rooms placed
      address: `${name} Hall, ${INSTITUTION.city}`,
      postcode: `FH${1 + (i % 9)} ${(i + 1)}AA`,
    });
  });

  // 5. Accommodation rooms — ~500 per hall, distributed by type weights
  const accomRooms = [];
  for (const h of halls) {
    const totalForHall = rng.int(450, 550);
    const roomsByType = ACCOMMODATION_ROOM_TYPES.flatMap((t) =>
      Array(Math.round(totalForHall * t.pct)).fill(t));
    rng.shuffle(roomsByType).forEach((t, idx) => {
      const roomNumber = (idx + 1).toString().padStart(4, '0');
      accomRooms.push({
        id: `arm-${h.id.slice(5)}-${roomNumber}`,
        ...ctx.audit(now),
        hallId: h.id, roomNumber: `${h.name.replace(' Hall', '')}-${roomNumber}`,
        roomType: t.code, capacity: t.capacity,
        pricePerTerm: t.price + rng.int(-100, 100),
        currency: 'GBP', hasEnsuite: t.ensuite,
      });
    });
    h.totalRooms = accomRooms.filter(r => r.hallId === h.id).length;
  }
  ctx.append('AccommodationHall', halls);
  ctx.append('AccommodationRoom', accomRooms);

  ctx.log(domain,
    `1 campus, ${buildings.length} buildings, ${rooms.length} rooms, ${halls.length} halls, ${accomRooms.length} accommodation rooms`);
}
