// Independent browser-engine observations for the one-bar beast_140bpm fixture.
import assert from 'node:assert/strict';
export function checkSchedule({sends, passes, origin, period}) {
  assert.ok(Number.isFinite(origin) && period > 0);
  // Note 72 occurs only at tick zero of this fixture's pass (not an API-derived timestamp).
  const openings = sends.filter(s => s[0] === 0x90 && s[1] === 72 && s[2] > 0).map(s => s[3]);
  assert.ok(openings.length >= 2, 'observe at least two actual engine passes');
  const maxError = Math.max(...openings.map((time, index) => Math.abs(time - (origin + index * period))));
  assert.ok(maxError <= 1e-6, `engine pass grid error ${maxError} s exceeds 1 us (missing, duplicate or shifted opening)`);
  let late = 0, minLead = Infinity;
  for (const send of sends) {
    const lead = send[3] - send[4];
    minLead = Math.min(minLead, lead);
    if (lead < 0) late++;
  }
  assert.equal(late, 0, `${late} actual engine sends scheduled behind currentTime; minimum lead ${minLead} s`);
  for (const pass of passes) {
    assert.ok(pass.passIndex < openings.length, 'announced pass has an observed engine opening');
    assert.ok(Math.abs(pass.startTime - openings[pass.passIndex]) <= 1e-6,
      `API pass ${pass.passIndex} disagrees with its actual engine opening`);
  }
  return {observed_passes: openings.length, scheduled_messages: sends.length,
    max_grid_error_seconds: maxError, minimum_lead_seconds: minLead, late};
}
