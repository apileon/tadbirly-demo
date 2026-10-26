// Bridge for tests/sql/test_32_tournaments.py: runs lib/tournament.js on JSON
// from stdin so the SQL test can store a real generated schedule and compare
// the server's tables/places with the app's.
import { generateSchedule, computeStandings, podium } from '../../lib/tournament';

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const req = JSON.parse(input);
  let out;
  if (req.mode === 'gen') out = generateSchedule(req);
  else if (req.mode === 'standings') out = computeStandings(req.teams, req.matches);
  else if (req.mode === 'podium') out = podium(req.format, req.teams, req.matches);
  process.stdout.write(JSON.stringify(out));
});
