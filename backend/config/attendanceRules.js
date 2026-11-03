// Timing rules shared by the attendance and session controllers.
// The server reads these once at startup. To change the limit without
// touching code, set INACTIVITY_LIMIT_SECONDS in the Render environment.

require("dotenv").config();

const DEFAULT_INACTIVITY_LIMIT_SECONDS = 7;

function readLimitSeconds() {
  const fromEnv = Number(process.env.INACTIVITY_LIMIT_SECONDS);

  if (Number.isFinite(fromEnv) && fromEnv >= 3 && fromEnv <= 60) {
    return fromEnv;
  }

  return DEFAULT_INACTIVITY_LIMIT_SECONDS;
}

// How long a student can go without a heartbeat before they are marked Incomplete.
const INACTIVITY_LIMIT_MS = readLimitSeconds() * 1000;

// With a longer limit, a heartbeat only needs to be saved to the database now
// and then, and the server answers from memory in between. This stays well under
// the inactivity limit so a saved timestamp is never old enough to mark an
// active student Incomplete. With a short limit (6s or less) there is no room to
// skip saves, so every heartbeat is saved (0 means "always save").
const HEARTBEAT_WRITE_EVERY_MS =
  INACTIVITY_LIMIT_MS <= 6000 ? 0 : Math.min(4000, Math.floor(INACTIVITY_LIMIT_MS / 2.5));

const INACTIVITY_REASON = `Missed heartbeat for more than ${INACTIVITY_LIMIT_MS / 1000} seconds.`;

module.exports = {
  INACTIVITY_LIMIT_MS,
  HEARTBEAT_WRITE_EVERY_MS,
  INACTIVITY_REASON,
};
