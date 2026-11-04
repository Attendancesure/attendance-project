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

// Every heartbeat is saved (0 means "always save"). Skipping saves made the
// stored timestamp up to ~4 seconds old, which left too little room before the
// inactivity limit when the server was busy. The server still answers each
// heartbeat with one database write instead of three.
const HEARTBEAT_WRITE_EVERY_MS = 0;

const INACTIVITY_REASON = `Missed heartbeat for more than ${INACTIVITY_LIMIT_MS / 1000} seconds.`;

module.exports = {
  INACTIVITY_LIMIT_MS,
  HEARTBEAT_WRITE_EVERY_MS,
  INACTIVITY_REASON,
};

