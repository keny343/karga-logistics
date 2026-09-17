/**
 * The centre of Luanda. Used to frame a map that has nothing to show yet — an empty
 * map that opens on the middle of the Atlantic looks broken rather than empty.
 *
 * The backend has the same constant, because it also has to answer "where should
 * this map look" without a browser. Duplicating one pair of numbers is cheaper than
 * a request to learn them.
 */
export const CENTRO_LUANDA = { latitude: -8.8383, longitude: 13.2344 } as const;
