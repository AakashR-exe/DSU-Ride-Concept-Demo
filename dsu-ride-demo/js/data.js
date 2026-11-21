// Static demo data for the Dayananda Sagar University Harohalli campus.
// Campus outline and building positions: © OpenStreetMap contributors (ODbL), OSM way 1107054018.
// Scooters, battery levels and port counts are sample data. Coordinates are [latitude, longitude].

export const CAMPUS_BOUNDARY = [
  [12.662594, 77.455974], [12.662563, 77.456762], [12.660024, 77.45658], [12.660144, 77.455373],
  [12.658114, 77.455094], [12.658281, 77.45415], [12.658888, 77.452744], [12.658019, 77.452476],
  [12.658057, 77.451517], [12.656491, 77.451484], [12.656407, 77.449949], [12.657418, 77.449676],
  [12.657507, 77.450303], [12.657706, 77.450652], [12.658187, 77.449783], [12.658396, 77.448367],
  [12.657706, 77.447948], [12.657234, 77.447315], [12.657281, 77.447272], [12.657678, 77.446902],
  [12.658087, 77.446492], [12.659056, 77.44562], [12.660728, 77.447762], [12.662116, 77.449541],
  [12.663452, 77.451253], [12.662678, 77.451875], [12.660961, 77.452725], [12.660192, 77.452889],
  [12.660631, 77.453924], [12.662086, 77.454166],
];

/** Where "you" are when GPS is off or you're not on campus. */
export const DEMO_LOCATION = { at: [12.661641, 77.450018], label: 'Campus Yard' };

/** Charging points double as scooter bays. */
export const DOCKS = [
  { id: 'SOE', name: 'School of Engineering', at: [12.661816, 77.45062], freePorts: 3, totalPorts: 4, detail: 'Fast charge' },
  { id: 'ME', name: 'Mechanical Engg. Block', at: [12.662189, 77.451884], freePorts: 1, totalPorts: 2, detail: 'Small bay' },
  { id: 'G1', name: 'Gate 1 security', at: [12.662925, 77.4509], freePorts: 2, totalPorts: 2, detail: 'Next to security' },
  { id: 'CD', name: 'CDSIMER hospital', at: [12.660569, 77.449287], freePorts: 2, totalPorts: 3, detail: 'Near emergency reception' },
  { id: 'TT', name: 'Tummy Trails food court', at: [12.660309, 77.452679], freePorts: 4, totalPorts: 4, detail: 'Food court entrance' },
  { id: 'AR', name: 'DSU Arena & courts', at: [12.659638, 77.453289], freePorts: 3, totalPorts: 4, detail: 'Near sports courts' },
  { id: 'GH', name: 'Girls Hostel', at: [12.658886, 77.448748], freePorts: 0, totalPorts: 4, detail: 'Hostel bay' },
  { id: 'SR', name: 'S Residency boys hostel', at: [12.658323, 77.447983], freePorts: 2, totalPorts: 4, detail: 'Hostel bay' },
];

/** status: available | reserved | riding | fault */
export const SCOOTERS = [
  { id: 'DSU-022', battery: 64, dockId: 'SOE', status: 'available' },
  { id: 'DSU-011', battery: 45, dockId: 'CD', status: 'available' },
  { id: 'DSU-019', battery: 58, dockId: 'G1', status: 'available' },
  { id: 'DSU-031', battery: 71, dockId: 'ME', status: 'available' },
  { id: 'DSU-014', battery: 92, dockId: 'TT', status: 'available' },
  { id: 'DSU-026', battery: 77, dockId: 'AR', status: 'available' },
  { id: 'DSU-007', battery: 86, dockId: 'SR', status: 'available' },
];

/** Simulated geofence zones on the ride screen. */
export const ZONES = [
  { name: 'Main drive', speedCap: 15 },
  { name: 'Pedestrian gate', speedCap: 8 },
  { name: 'Courtyard / dining', speedCap: 0 },
];

export const FAULTS = ['Brake wear', 'Loose handlebar', 'Flat tire'];

export const RULES = {
  reservationMs: 10 * 60 * 1000,
  skipHoldMs: 12 * 1000, // "Demo: skip to end of hold" leaves this much time
  scanVerifyMs: 1100, // simulated wallet check after scanning
  minBattery: 20, // scooters below this are hidden from riders
  minParkedBattery: 5,
  depositRupees: 50,
  walkDetour: 1.25, // campus paths are ~25% longer than a straight line
  walkMetersPerMinute: 80,
  defaultThrottle: 12,
  maxThrottle: 25,
  maxTickGapMs: 60 * 1000, // cap simulated riding when the app was asleep
};
