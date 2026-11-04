const Session = require("../models/Session");
const Attendance = require("../models/Attendance");

const { INACTIVITY_LIMIT_MS } = require("../config/attendanceRules");

/* =========================
   CODE GENERATION
========================= */
function generateSessionCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

async function generateUniqueSessionCode() {
  let code;
  let exists = true;

  while (exists) {
    code = generateSessionCode();
    const existing = await Session.findOne({ sessionCode: code });
    if (!existing) exists = false;
  }

  return code;
}

/* =========================
   CREATE SESSION (SECURE)
========================= */
exports.createSession = async (req, res) => {
  try {
    const {
      courseCode,
      courseTitle,
      sessionNumber,
      duration,
      topic
    } = req.body;

    const lecturerId = req.user.id;
    const lecturerEmail = req.user.email;

    if (!courseCode || !courseTitle || !sessionNumber) {
      return res.status(400).json({
        message: "Course code, title, and session number are required."
      });
    }

    const existingActiveSession = await Session.findOne({
      lecturerId,
      status: "active"
    });

    if (existingActiveSession) {
      if (new Date() >= existingActiveSession.expiresAt) {
        existingActiveSession.status = "expired";
        await existingActiveSession.save();
      } else {
      return res.status(400).json({
        message: "You already have an active session."
      });
      }
    }

    const sessionCode = await generateUniqueSessionCode();

    const durationInSeconds = Number(duration) || 60;
    const startsAt = new Date();
    const expiresAt = new Date(Date.now() + durationInSeconds * 1000);

    const session = await Session.create({
      lecturerId,
      lecturerEmail,
      courseCode: courseCode.toUpperCase(),
      courseTitle,
      sessionNumber,
      sessionCode,
      duration: durationInSeconds,
      topic: topic || "",
      startsAt,
      expiresAt,
      status: "active"
    });

    // 🔥 IMPORTANT: Only lecturer sees code
    res.status(201).json({
      message: "Session created.",
      session,
      serverTime: new Date()
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to create session.",
      error: error.message
    });
  }
};

/* =========================
   GET ACTIVE SESSION
========================= */
exports.getActiveSession = async (req, res) => {
  try {
    const lecturerId = req.user.id;

    const session = await Session.findOne({
      lecturerId,
      status: "active"
    }).sort({ createdAt: -1 });

    if (!session) {
      return res.status(404).json({
        message: "No active session."
      });
    }

    if (new Date() > session.expiresAt) {
      session.status = "expired";
      await session.save();
    }

    res.status(200).json({
      message: "Active session fetched.",
      session,
      serverTime: new Date()
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch session.",
      error: error.message
    });
  }
};

/* =========================
   END SESSION
========================= */
exports.endSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({
        message: "Session not found."
      });
    }

    if (String(session.lecturerId) !== req.user.id) {
      return res.status(403).json({
        message: "Unauthorized."
      });
    }

    session.status = "ended";
    session.endedAt = new Date();

    await session.save();

    const staleBefore = new Date(session.endedAt.getTime() - INACTIVITY_LIMIT_MS);

    await Attendance.updateMany(
      {
        sessionId: session._id,
        status: "Pending",
        lastActive: { $lt: staleBefore }
      },
      {
        $set: {
          status: "Incomplete",
          isActive: false,
          completedAt: session.endedAt,
          inactiveReason: "Missed heartbeat before session ended."
        }
      }
    );

    await Attendance.updateMany(
      {
        sessionId: session._id,
        status: "Pending",
        lastActive: { $gte: staleBefore }
      },
      {
        $set: {
          status: "Confirmed",
          isActive: false,
          completedAt: session.endedAt
        }
      }
    );

    res.status(200).json({
      message: "Session ended.",
      session
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to end session.",
      error: error.message
    });
  }
};

/* =========================
   GET LECTURER SESSIONS
========================= */
exports.getLecturerSessions = async (req, res) => {
  try {
    const lecturerId = req.user.id;

    const sessions = await Session.find({ lecturerId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Sessions fetched.",
      sessions
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch sessions.",
      error: error.message
    });
  }
};

/* =========================
   GET SESSION BY CODE (SAFE)
========================= */
exports.getSessionByCode = async (req, res) => {
  try {
    const { sessionCode } = req.params;

    const session = await Session.findOne({
      sessionCode: sessionCode.toUpperCase()
    });

    if (!session) {
      return res.status(404).json({
        message: "Session not found."
      });
    }

    if (session.status !== "active" || new Date() > session.expiresAt) {
      if (session.status === "active" && new Date() > session.expiresAt) {
        session.status = "expired";
        await session.save();
      }

      return res.status(400).json({
        message: "Session is not active."
      });
    }

    // 🔥 DO NOT expose sessionCode to students
    res.status(200).json({
      message: "Session found.",
      session: {
        id: session._id,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionNumber: session.sessionNumber,
        duration: session.duration,
        expiresAt: session.expiresAt,
        status: session.status
      },
      serverTime: new Date()
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch session.",
      error: error.message
    });
  }
};
