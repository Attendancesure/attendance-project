const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Session = require("../models/Session");
const Student = require("../models/Student");
const {
  INACTIVITY_LIMIT_MS,
  HEARTBEAT_WRITE_EVERY_MS,
  INACTIVITY_REASON,
} = require("../config/attendanceRules");

function publicAttendance(attendance) {
  return {
    _id: attendance._id,
    sessionId: attendance.sessionId,
    studentId: attendance.studentId,
    studentName: attendance.studentName,
    matricNumber: attendance.matricNumber,
    department: attendance.department,
    level: attendance.level,
    status: attendance.status,
    submittedAt: attendance.submittedAt,
    joinedAt: attendance.joinedAt,
    lastActive: attendance.lastActive,
    completedAt: attendance.completedAt,
    isActive: attendance.isActive,
  };
}

async function expireSessionIfNeeded(session, now = new Date()) {
  if (session.status === "active" && now >= session.expiresAt) {
    session.status = "expired";
    await session.save();
  }

  return session;
}

async function markStaleAttendance(sessionId, now = new Date()) {
  const staleBefore = new Date(now.getTime() - INACTIVITY_LIMIT_MS);

  await Attendance.updateMany(
    {
      sessionId,
      status: "Pending",
      isActive: true,
      lastActive: { $lt: staleBefore },
    },
    {
      $set: {
        status: "Incomplete",
        isActive: false,
        inactiveReason: INACTIVITY_REASON,
        completedAt: now,
      },
    }
  );
}

async function finalizeExpiredAttendance(session, now = new Date()) {
  // After the session ends, everyone is judged as of the end time, so the result
  // is the same whether this runs one second or one minute later.
  const judgedAt = now >= session.expiresAt ? session.expiresAt : now;

  await markStaleAttendance(session._id, judgedAt);

  if (now < session.expiresAt) return;

  await Attendance.updateMany(
    {
      sessionId: session._id,
      status: "Pending",
      isActive: true,
      lastActive: { $gte: new Date(judgedAt.getTime() - INACTIVITY_LIMIT_MS) },
    },
    {
      $set: {
        status: "Confirmed",
        isActive: false,
        completedAt: now,
      },
    }
  );

  await Attendance.updateMany(
    {
      sessionId: session._id,
      status: "Pending",
      isActive: false,
    },
    {
      $set: {
        status: "Expired",
        completedAt: now,
      },
    }
  );
}

// Finishes sessions whose time is up, whether or not anyone is watching the
// lecturer dashboard or sending a final heartbeat. server.js runs this every
// couple of seconds. Running it again on a finished session changes nothing.
let finalizingDueSessions = false;

exports.finalizeDueSessions = async () => {
  if (finalizingDueSessions) return;
  finalizingDueSessions = true;

  try {
    const now = new Date();
    const dueSessions = await Session.find({
      status: "active",
      expiresAt: { $lte: now },
    }).limit(25);

    for (const session of dueSessions) {
      await finalizeExpiredAttendance(session, now);
      await Session.updateOne(
        { _id: session._id, status: "active" },
        { $set: { status: "expired" } }
      );
    }
  } catch (error) {
    console.error("Finalizing expired sessions failed:", error.message);
  } finally {
    finalizingDueSessions = false;
  }
};

exports.submitAttendance = async (req, res) => {
  try {
    const { sessionCode, matricNumber } = req.body;
    const normalizedMatric = matricNumber ? matricNumber.toUpperCase().trim() : "";

    if (!sessionCode || !normalizedMatric) {
      return res.status(400).json({
        message: "Please provide session code and matric number.",
      });
    }

    if (req.user.matricNumber !== normalizedMatric) {
      return res.status(403).json({
        message: "You can only submit attendance with your own matric number.",
      });
    }

    const now = new Date();
    const session = await Session.findOne({
      sessionCode: sessionCode.toUpperCase().trim(),
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    await expireSessionIfNeeded(session, now);

    if (session.status !== "active" || now >= session.expiresAt) {
      return res.status(400).json({ message: "Session is not active." });
    }

    const student = await Student.findOne({ matricNumber: normalizedMatric });

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const activeBlockers = await Attendance.find({
      studentId: student._id,
      status: { $in: ["Pending", "Incomplete"] },
    }).sort({ createdAt: -1 });

    for (const blocker of activeBlockers) {
      const blockerSession = await Session.findById(blocker.sessionId);
      if (!blockerSession) continue;

      await expireSessionIfNeeded(blockerSession, now);

      const blockerSessionStillRunning =
        blockerSession.status === "active" && now < blockerSession.expiresAt;

      if (!blockerSessionStillRunning) continue;

      const blockerLastActive =
        blocker.lastActive || blocker.joinedAt || blocker.submittedAt;
      const blockerInactiveForMs =
        now.getTime() - new Date(blockerLastActive).getTime();

      if (
        blocker.status === "Pending" &&
        blocker.isActive &&
        blockerInactiveForMs > INACTIVITY_LIMIT_MS
      ) {
        blocker.status = "Incomplete";
        blocker.isActive = false;
        blocker.completedAt = now;
        blocker.inactiveReason = INACTIVITY_REASON;
        await blocker.save();
      }

      if (String(blocker.sessionId) === String(session._id)) {
        if (blocker.status === "Incomplete") {
          return res.status(403).json({
            message: "You were marked incomplete and cannot rejoin this session until it ends.",
            attendance: publicAttendance(blocker),
          });
        }

        break;
      }

      return res.status(409).json({
        message: "You cannot join another attendance session until your current session ends.",
        attendance: publicAttendance(blocker),
      });
    }

    const lockedAttendance = await Attendance.findOne({
      studentId: student._id,
      isActive: true,
      status: "Pending",
    });

    if (lockedAttendance) {
      const lockedSession = await Session.findById(lockedAttendance.sessionId);
      const lockedLastActive =
        lockedAttendance.lastActive ||
        lockedAttendance.joinedAt ||
        lockedAttendance.submittedAt;
      const lockedInactiveForMs = now.getTime() - new Date(lockedLastActive).getTime();

      if (
        !lockedSession ||
        now >= lockedSession.expiresAt
      ) {
        lockedAttendance.status = "Expired";
        lockedAttendance.isActive = false;
        lockedAttendance.completedAt = now;
        lockedAttendance.inactiveReason = "Previous session is no longer active.";
        await lockedAttendance.save();
      }
    }

    if (
      lockedAttendance &&
      lockedAttendance.isActive &&
      String(lockedAttendance.sessionId) !== String(session._id)
    ) {
      return res.status(409).json({
        message: "You already have an active attendance session. Finish it before joining another.",
        attendance: publicAttendance(lockedAttendance),
      });
    }

    const existingAttendance = await Attendance.findOne({
      sessionId: session._id,
      studentId: student._id,
    });

    if (existingAttendance) {
      const lastActive =
        existingAttendance.lastActive ||
        existingAttendance.joinedAt ||
        existingAttendance.submittedAt;
      const inactiveForMs = now.getTime() - new Date(lastActive).getTime();

      if (
        existingAttendance.status === "Pending" &&
        existingAttendance.isActive &&
        inactiveForMs > INACTIVITY_LIMIT_MS
      ) {
        existingAttendance.status = "Incomplete";
        existingAttendance.isActive = false;
        existingAttendance.completedAt = now;
        existingAttendance.inactiveReason = INACTIVITY_REASON;
        await existingAttendance.save();
      }

      if (existingAttendance.status === "Incomplete") {
        return res.status(403).json({
          message: "You were marked incomplete and cannot rejoin this session.",
          attendance: publicAttendance(existingAttendance),
        });
      }

      return res.status(200).json({
        message: "Attendance already exists for this session.",
        attendance: publicAttendance(existingAttendance),
        session: {
          id: session._id,
          courseCode: session.courseCode,
          courseTitle: session.courseTitle,
          sessionNumber: session.sessionNumber,
          duration: session.duration,
          expiresAt: session.expiresAt,
          status: session.status,
        },
      });
    }

    const attendance = await Attendance.create({
      sessionId: session._id,
      lecturerId: session.lecturerId,
      studentId: student._id,
      studentName: student.fullName,
      matricNumber: student.matricNumber,
      department: student.department,
      level: student.level,
      status: "Pending",
      submittedAt: now,
      joinedAt: now,
      lastActive: now,
      isActive: true,
    });

    res.status(201).json({
      message: "Attendance session joined. Keep this page active until the timer ends.",
      attendance: publicAttendance(attendance),
      heartbeatEveryMs: 2000,
      inactivityLimitMs: INACTIVITY_LIMIT_MS,
      session: {
        id: session._id,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionNumber: session.sessionNumber,
        duration: session.duration,
        expiresAt: session.expiresAt,
        status: session.status,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to submit attendance.",
      error: error.message,
    });
  }
};

// The full heartbeat check. It handles every case, including the unusual ones
// (finalized, marked incomplete, missing records), and is the fallback for the
// fast path below.
const heartbeatFromDatabase = async (req, res) => {
  try {
    const { attendanceId } = req.body;

    if (!attendanceId) {
      return res.status(400).json({ message: "Attendance ID is required." });
    }

    const attendance = await Attendance.findById(attendanceId);

    if (!attendance) {
      return res.status(404).json({ message: "Attendance not found." });
    }

    if (String(attendance.studentId) !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized attendance heartbeat." });
    }

    const session = await Session.findById(attendance.sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    const now = new Date();
    await expireSessionIfNeeded(session, now);

    if (attendance.status === "Incomplete") {
      return res.status(403).json({
        message: "Attendance is incomplete. You cannot rejoin this session.",
        status: attendance.status,
      });
    }

    if (attendance.status !== "Pending") {
      return res.status(200).json({
        message: "Attendance already finalized.",
        status: attendance.status,
        serverTime: now,
        expiresAt: session.expiresAt,
      });
    }

    const lastActive = attendance.lastActive || attendance.joinedAt || attendance.submittedAt;
    const inactiveForMs = now.getTime() - new Date(lastActive).getTime();

    if (inactiveForMs > INACTIVITY_LIMIT_MS) {
      attendance.status = "Incomplete";
      attendance.isActive = false;
      attendance.completedAt = now;
      attendance.inactiveReason = INACTIVITY_REASON;
      await attendance.save();

      return res.status(403).json({
        message: "Marked incomplete due to inactivity.",
        status: attendance.status,
        inactiveForMs,
      });
    }

    attendance.lastActive = now;

    if (now >= session.expiresAt) {
      attendance.status = "Confirmed";
      attendance.isActive = false;
      attendance.completedAt = now;
    }

    await attendance.save();

    res.status(200).json({
      message: "Heartbeat recorded.",
      status: attendance.status,
      serverTime: now,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    res.status(500).json({
      message: "Heartbeat failed.",
      error: error.message,
    });
  }
};

// Heartbeat fast path.
//
// Every student pings every couple of seconds, so with a full class this is by
// far the busiest route. Most pings only need to confirm "still here", so we
// remember each running attendance in memory and save to the database at most
// once every HEARTBEAT_WRITE_EVERY_MS. Anything unusual falls back to the full
// check above. A session's expiry time never changes, so caching it is safe.
const heartbeatCache = new Map();

setInterval(() => {
  const cutoff = Date.now() - 60 * 1000;

  for (const [attendanceId, entry] of heartbeatCache) {
    if (entry.expiresAtMs < cutoff) heartbeatCache.delete(attendanceId);
  }
}, 60 * 1000).unref();

exports.heartbeat = async (req, res) => {
  try {
    const { attendanceId } = req.body;

    if (!attendanceId || !mongoose.isValidObjectId(attendanceId)) {
      return heartbeatFromDatabase(req, res);
    }

    const nowMs = Date.now();
    const cached = heartbeatCache.get(attendanceId);

    if (
      cached &&
      cached.studentId === req.user.id &&
      nowMs < cached.expiresAtMs &&
      nowMs - cached.savedAtMs < HEARTBEAT_WRITE_EVERY_MS
    ) {
      return res.status(200).json({
        message: "Heartbeat recorded.",
        status: "Pending",
        serverTime: new Date(nowMs),
        expiresAt: new Date(cached.expiresAtMs),
      });
    }

    const now = new Date(nowMs);

    // One write that only succeeds for this student's own, still-running attendance.
    const updated = await Attendance.findOneAndUpdate(
      {
        _id: attendanceId,
        studentId: req.user.id,
        status: "Pending",
        isActive: true,
        lastActive: { $gte: new Date(nowMs - INACTIVITY_LIMIT_MS) },
      },
      { $set: { lastActive: now } },
      { projection: { sessionId: 1 } }
    ).lean();

    if (!updated) {
      heartbeatCache.delete(attendanceId);
      return heartbeatFromDatabase(req, res);
    }

    let expiresAtMs = cached ? cached.expiresAtMs : null;

    if (expiresAtMs === null) {
      const session = await Session.findById(updated.sessionId, { expiresAt: 1 }).lean();

      if (!session) {
        return heartbeatFromDatabase(req, res);
      }

      expiresAtMs = session.expiresAt.getTime();
    }

    if (nowMs >= expiresAtMs) {
      await Attendance.updateOne(
        { _id: updated._id, status: "Pending" },
        { $set: { status: "Confirmed", isActive: false, completedAt: now } }
      );
      await Session.updateOne(
        { _id: updated.sessionId, status: "active" },
        { $set: { status: "expired" } }
      );

      heartbeatCache.delete(attendanceId);

      return res.status(200).json({
        message: "Heartbeat recorded.",
        status: "Confirmed",
        serverTime: now,
        expiresAt: new Date(expiresAtMs),
      });
    }

    heartbeatCache.set(attendanceId, {
      studentId: req.user.id,
      expiresAtMs,
      savedAtMs: nowMs,
    });

    return res.status(200).json({
      message: "Heartbeat recorded.",
      status: "Pending",
      serverTime: now,
      expiresAt: new Date(expiresAtMs),
    });
  } catch (error) {
    res.status(500).json({
      message: "Heartbeat failed.",
      error: error.message,
    });
  }
};

exports.updateAttendanceStatus = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { status } = req.body;

    if (!["Pending", "Confirmed", "Incomplete", "Expired"].includes(status)) {
      return res.status(400).json({ message: "Invalid attendance status." });
    }

    const attendance = await Attendance.findById(attendanceId);

    if (!attendance) {
      return res.status(404).json({ message: "Attendance not found." });
    }

    const session = await Session.findById(attendance.sessionId);

    if (!session || String(session.lecturerId) !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    attendance.status = status;
    attendance.isActive = status === "Pending";
    attendance.completedAt = status === "Pending" ? null : new Date();
    await attendance.save();

    res.status(200).json({
      message: "Attendance status updated.",
      attendance: publicAttendance(attendance),
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update attendance status.",
      error: error.message,
    });
  }
};

exports.getSessionAttendance = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    if (String(session.lecturerId) !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    const now = new Date();
    await finalizeExpiredAttendance(session, now);

    const attendanceRecords = await Attendance.find({ sessionId })
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      message: "Attendance records fetched.",
      attendanceRecords,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch attendance records.",
      error: error.message,
    });
  }
};

exports.getStudentSessionAttendance = async (req, res) => {
  try {
    const { sessionId, matricNumber } = req.params;
    const normalizedMatric = matricNumber.toUpperCase().trim();

    if (req.user.role === "student" && req.user.matricNumber !== normalizedMatric) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    const attendance = await Attendance.findOne({
      sessionId,
      matricNumber: normalizedMatric,
    });

    if (!attendance) {
      return res.status(404).json({ message: "Attendance not found." });
    }

    res.status(200).json({
      message: "Student attendance fetched.",
      attendance: publicAttendance(attendance),
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch student attendance.",
      error: error.message,
    });
  }
};

exports.getLecturerAttendanceSummary = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    if (String(session.lecturerId) !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    const now = new Date();
    await finalizeExpiredAttendance(session, now);

    const rows = await Attendance.aggregate([
      { $match: { sessionId: session._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const summary = {
      total: 0,
      confirmed: 0,
      incomplete: 0,
      expired: 0,
      pending: 0,
    };

    rows.forEach((row) => {
      summary.total += row.count;
      summary[String(row._id).toLowerCase()] = row.count;
    });

    res.status(200).json({
      message: "Attendance summary fetched.",
      summary,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch attendance summary.",
      error: error.message,
    });
  }
};
