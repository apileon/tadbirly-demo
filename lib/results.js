// Points and labels for event results.
export const PLACES = [1, 2, 3, 4, 5];
export const medal = (place) => (place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : place ? '🏅' : '');
export const placeLabel = (place) => (place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : place ? `${place}th` : '');

// Every accepted participant earns 5; placed participants earn more.
export function pointsFor(place) {
  if (place === 1) return 50;
  if (place === 2) return 30;
  if (place === 3) return 20;
  if (place) return 10;
  return 5;
}
export const totalPoints = (results) => (results ?? []).reduce((s, r) => s + pointsFor(r.place), 0);
export const winsCount = (results) => (results ?? []).filter((r) => r.place === 1).length;
