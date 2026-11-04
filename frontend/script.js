
const API_BASE = window.API_BASE || "https://attend-sure-t9r4.onrender.com/api";

const STORAGE_KEYS = {
  theme: "attendsure_theme",
  resultData: "attendsure_result_data",
  currentStudentKey: "attendsure_current_student",
  currentLecturerKey: "attendsure_current_lecturer",
  studentObject: "student",
  lecturerObject: "lecturer",
  token: "token",
  activeSessionBase: "attendsure_active_session",
  selectedHistorySessionBase: "attendsure_selected_history_session",
  historyBadgeCountBase: "attendsure_history_badge_count",
  verificationContext: "attendsure_verification_context"
};


let lecturerHistoryCache = [];
let dashboardInterval = null;
let dashboardCountdownInterval = null;
let verificationInterval = null;

/* =========================
   Server clock
   Countdowns follow the server's clock, not the device's. A phone or PC that is
   a few seconds fast would otherwise reach 00:00 early and report "Incomplete"
   while the session is still running. Every API reply that carries `serverTime`
   refreshes the offset.
========================= */
const CLOCK_OFFSET_KEY = "attendsure_clock_offset";
let serverClockOffsetMs = 0;

try {
  serverClockOffsetMs = Number(localStorage.getItem(CLOCK_OFFSET_KEY)) || 0;
} catch (error) {
  serverClockOffsetMs = 0;
}

function serverNow() {
  return Date.now() + serverClockOffsetMs;
}

function syncServerClock(serverTime, requestSentAt) {
  const serverMs = new Date(serverTime).getTime();
  if (!Number.isFinite(serverMs)) return;

  const receivedAt = Date.now();
  const halfTripMs = requestSentAt ? Math.max(0, (receivedAt - requestSentAt) / 2) : 0;
  const nextOffset = serverMs + halfTripMs - receivedAt;

  // Ignore tiny changes so the countdown does not twitch from network jitter.
  if (Math.abs(nextOffset - serverClockOffsetMs) < 300) return;

  serverClockOffsetMs = nextOffset;

  try {
    localStorage.setItem(CLOCK_OFFSET_KEY, String(nextOffset));
  } catch (error) {
    // Storage can be blocked; the offset still works for this page.
  }
}

/* =========================
   General Helpers
========================= */
function formatTimeRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getDurationLabel(seconds) {
  if (seconds === 30) return "30 seconds";
  if (seconds === 45) return "45 seconds";
  if (seconds === 60) return "1 minute";
  if (seconds === 90) return "90 seconds";
  if (seconds === 120) return "2 minutes";
  return `${seconds} seconds`;
}

function getCurrentTimeString() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getInputValue(id) {
  const element = document.getElementById(id);
  return element ? element.value : "";
}

function redirectWithDelay(url, delay = 600) {
  setTimeout(() => {
    window.location.href = url;
  }, delay);
}

function formatDisplayDate(dateValue) {
  if (!dateValue) return "Not Available";
  return new Date(dateValue).toLocaleDateString();
}

function formatDisplayTime(dateValue) {
  if (!dateValue) return "Not Available";
  return new Date(dateValue).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}
async function sendHeartbeat(attendanceId) {
  try {
    return await apiRequest("/attendance/heartbeat", {
      method: "POST",
      body: JSON.stringify({ attendanceId })
    });
  } catch (error) {
    console.warn("Heartbeat failed:", error.message);
    throw error;
  }
}

/* =========================
   API Helper
========================= */
async function apiRequest(path, options = {}) {
  const token = localStorage.getItem(STORAGE_KEYS.token);

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const requestSentAt = Date.now();

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (data && data.serverTime) {
    syncServerClock(data.serverTime, requestSentAt);
  }

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

/* =========================
   App Alert
========================= */
function showAppAlert(message, type = "info") {
  const alertBox = document.getElementById("app-alert");
  if (!alertBox) return;

  alertBox.textContent = message;
  alertBox.className = `app-alert ${type} show`;

  clearTimeout(showAppAlert._timer);
  showAppAlert._timer = setTimeout(() => {
    alertBox.classList.remove("show");
  }, 2600);
}

/* =========================
   Current Logged In User
========================= */
function setCurrentStudent(matricNumber) {
  localStorage.setItem(STORAGE_KEYS.currentStudentKey, matricNumber.toUpperCase());
}

function getCurrentStudent() {
  return localStorage.getItem(STORAGE_KEYS.currentStudentKey);
}

function clearCurrentStudent() {
  localStorage.removeItem(STORAGE_KEYS.currentStudentKey);
  localStorage.removeItem(STORAGE_KEYS.studentObject);
  localStorage.removeItem(STORAGE_KEYS.token);
  clearVerificationContext();
}

function setCurrentLecturer(email) {
  localStorage.setItem(STORAGE_KEYS.currentLecturerKey, email.toLowerCase());
}

function getCurrentLecturer() {
  return localStorage.getItem(STORAGE_KEYS.currentLecturerKey);
}

function clearCurrentLecturer() {
  localStorage.removeItem(STORAGE_KEYS.currentLecturerKey);
  localStorage.removeItem(STORAGE_KEYS.lecturerObject);
  localStorage.removeItem(STORAGE_KEYS.token);
  clearSession();
  clearSelectedHistorySession();
}

function getCurrentStudentProfile() {
  const raw = localStorage.getItem(STORAGE_KEYS.studentObject);
  return raw ? JSON.parse(raw) : null;
}

function setCurrentStudentProfile(profile) {
  localStorage.setItem(STORAGE_KEYS.studentObject, JSON.stringify(profile));
  if (profile?.matricNumber) {
    setCurrentStudent(profile.matricNumber);
  }
}

function getCurrentLecturerProfile() {
  const raw = localStorage.getItem(STORAGE_KEYS.lecturerObject);
  return raw ? JSON.parse(raw) : null;
}

function setCurrentLecturerProfile(profile) {
  localStorage.setItem(STORAGE_KEYS.lecturerObject, JSON.stringify(profile));
  if (profile?.email) {
    setCurrentLecturer(profile.email);
  }
}

function getLecturerScopedKey(baseKey) {
  const lecturer = getCurrentLecturer();
  return lecturer ? `${baseKey}_${lecturer}` : baseKey;
}

/* =========================
   Session Cache
========================= */
function saveSession(sessionData) {
  localStorage.setItem(
    getLecturerScopedKey(STORAGE_KEYS.activeSessionBase),
    JSON.stringify(sessionData)
  );
}

function getSession() {
  const raw = localStorage.getItem(
    getLecturerScopedKey(STORAGE_KEYS.activeSessionBase)
  );
  return raw ? JSON.parse(raw) : null;
}

function clearSession() {
  localStorage.removeItem(getLecturerScopedKey(STORAGE_KEYS.activeSessionBase));
}

function saveSelectedHistorySession(session) {
  localStorage.setItem(
    getLecturerScopedKey(STORAGE_KEYS.selectedHistorySessionBase),
    JSON.stringify(session)
  );
}

function getSelectedHistorySession() {
  const raw = localStorage.getItem(
    getLecturerScopedKey(STORAGE_KEYS.selectedHistorySessionBase)
  );
  return raw ? JSON.parse(raw) : null;
}

function clearSelectedHistorySession() {
  localStorage.removeItem(
    getLecturerScopedKey(STORAGE_KEYS.selectedHistorySessionBase)
  );
}

function getHistoryBadgeCount() {
  const raw = localStorage.getItem(
    getLecturerScopedKey(STORAGE_KEYS.historyBadgeCountBase)
  );
  return raw ? Number(raw) : 0;
}

function setHistoryBadgeCount(count) {
  localStorage.setItem(
    getLecturerScopedKey(STORAGE_KEYS.historyBadgeCountBase),
    String(count)
  );
}

function incrementHistoryBadgeCount() {
  setHistoryBadgeCount(getHistoryBadgeCount() + 1);
}

function resetHistoryBadgeCount() {
  setHistoryBadgeCount(0);
}

/* =========================
   Verification Context
========================= */
function saveVerificationContext(data) {
  localStorage.setItem(STORAGE_KEYS.verificationContext, JSON.stringify(data));
}

function getVerificationContext() {
  const raw = localStorage.getItem(STORAGE_KEYS.verificationContext);
  return raw ? JSON.parse(raw) : null;
}

function clearVerificationContext() {
  localStorage.removeItem(STORAGE_KEYS.verificationContext);
}

/* =========================
   Result Page Storage
========================= */
function saveResultData(data) {
  localStorage.setItem(STORAGE_KEYS.resultData, JSON.stringify(data));
}

function getResultData() {
  const raw = localStorage.getItem(STORAGE_KEYS.resultData);
  return raw ? JSON.parse(raw) : null;
}

function clearResultData() {
  localStorage.removeItem(STORAGE_KEYS.resultData);
}

/* =========================
   Theme
========================= */
function applySavedTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);

  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
  } else {
    document.body.classList.remove("light-theme");
  }
}

function initThemeToggle() {
  const toggleBtn = document.getElementById("theme-toggle-btn");
  if (!toggleBtn) return;

  function updateButtonText() {
    const isLight = document.body.classList.contains("light-theme");
    toggleBtn.textContent = isLight ? "Dark Mode" : "Light Mode";
    toggleBtn.setAttribute("aria-pressed", String(isLight));
  }

  toggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const isLight = document.body.classList.contains("light-theme");
    localStorage.setItem(STORAGE_KEYS.theme, isLight ? "light" : "dark");
    updateButtonText();
  });

  updateButtonText();
}

/* =========================
   Profile Identity
========================= */
function getInitials(name) {
  if (!name) return "--";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function renderLecturerProfileIdentity() {
  const nameEl = document.getElementById("lecturer-profile-name");
  const subEl = document.getElementById("lecturer-profile-sub");
  const avatarEl = document.getElementById("lecturer-profile-avatar");
  const topbarNameEl = document.getElementById("topbar-lecturer-name");

  if (!nameEl || !subEl || !avatarEl) return;

  const profile = getCurrentLecturerProfile();
  if (!profile) return;

  nameEl.textContent = profile.fullName || "Lecturer";
  subEl.textContent = profile.email || "Lecturer Account";
  avatarEl.textContent = getInitials(profile.fullName);
  if (topbarNameEl) {
    topbarNameEl.textContent = profile.fullName ? profile.fullName.split(" ")[0] : "Lecturer";
  }
}

function renderStudentProfileIdentity() {
  const nameEl = document.getElementById("student-profile-name");
  const subEl = document.getElementById("student-profile-sub");
  const avatarEl = document.getElementById("student-profile-avatar");

  if (!nameEl || !subEl || !avatarEl) return;

  const profile = getCurrentStudentProfile();
  if (!profile) return;

  nameEl.textContent = profile.fullName || "Student";
  subEl.textContent = profile.matricNumber || "Student Account";
  avatarEl.textContent = getInitials(profile.fullName);
}

/* =========================
   Password Toggle
========================= */
function initPasswordToggle() {
  const toggles = document.querySelectorAll(".toggle-password");

  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const wrap = toggle.closest(".password-wrap");
      if (!wrap) return;

      const input = wrap.querySelector("input");
      if (!input) return;

      if (input.type === "password") {
        input.type = "text";
        toggle.textContent = "Show";
      } else {
        input.type = "password";
        toggle.textContent = "Show";
      }
    });
  });
}

/* =========================
   Auth
========================= */
function initStudentRegistration() {
  const form = document.getElementById("student-register-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = getInputValue("full-name").trim();
    const matricNumber = getInputValue("matric-number").trim().toUpperCase();
    const department = getInputValue("department").trim();
    const level = getInputValue("level");
    const email = getInputValue("email").trim().toLowerCase();
    const password = getInputValue("password");
    const confirmPassword = getInputValue("confirm-password");

    if (!fullName || !matricNumber || !department || !level || !password || !confirmPassword) {
      showAppAlert("Please complete all required fields.", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showAppAlert("Passwords do not match.", "error");
      return;
    }

    try {
      await apiRequest("/auth/students/register", {
        method: "POST",
        body: JSON.stringify({
          fullName,
          matricNumber,
          department,
          level,
          email,
          password
        })
      });

      showAppAlert("Student registration successful.", "success");
      redirectWithDelay("student-login.html");
    } catch (error) {
      showAppAlert(error.message || "Student registration failed.", "error");
    }
  });
}

function initStudentLogin() {
  const form = document.getElementById("student-login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const matricNumber = getInputValue("matric-number").trim().toUpperCase();
    const password = getInputValue("password");

    if (!matricNumber || !password) {
      showAppAlert("Please enter matric number and password.", "warning");
      return;
    }

    try {
      const data = await apiRequest("/auth/students/login", {
        method: "POST",
        body: JSON.stringify({
          matricNumber,
          password
        })
      });

      localStorage.setItem(STORAGE_KEYS.token, data.token);

      const normalizedStudent = {
        id: data.student.id,
        fullName: data.student.fullName,
        matricNumber: data.student.matricNumber,
        department: data.student.department,
        level: data.student.level,
        email: data.student.email || "",
        role: data.student.role
      };

      setCurrentStudentProfile(normalizedStudent);

      showAppAlert("Student access granted.", "success");
      redirectWithDelay("student-verification.html");
    } catch (error) {
      showAppAlert(error.message || "Login failed.", "error");
    }
  });
}

function initLecturerRegistration() {
  const form = document.getElementById("lecturer-register-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = getInputValue("lecturer-full-name").trim();
    const email = getInputValue("lecturer-email-register").trim().toLowerCase();
    const password = getInputValue("lecturer-password-register");
    const confirmPassword = getInputValue("lecturer-confirm-password");

    if (!fullName || !email || !password || !confirmPassword) {
      showAppAlert("Please complete all fields.", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showAppAlert("Passwords do not match.", "error");
      return;
    }

    try {
      await apiRequest("/auth/lecturers/register", {
        method: "POST",
        body: JSON.stringify({
          fullName,
          email,
          password
        })
      });

      showAppAlert("Lecturer registration successful.", "success");
      redirectWithDelay("lecturer-login.html");
    } catch (error) {
      showAppAlert(error.message || "Registration failed.", "error");
    }
  });
}

function initLecturerLogin() {
  const form = document.getElementById("lecturer-login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = getInputValue("lecturer-email").trim().toLowerCase();
    const password = getInputValue("lecturer-password");

    if (!email || !password) {
      showAppAlert("Please enter email and password.", "warning");
      return;
    }

    try {
      const data = await apiRequest("/auth/lecturers/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password
        })
      });

      localStorage.setItem(STORAGE_KEYS.token, data.token);

      const normalizedLecturer = {
        id: data.lecturer.id,
        fullName: data.lecturer.fullName,
        email: data.lecturer.email,
        role: data.lecturer.role
      };

      setCurrentLecturerProfile(normalizedLecturer);
      clearSelectedHistorySession();

      showAppAlert("Lecturer login successful.", "success");
      redirectWithDelay("lecturer-dashboard.html");
    } catch (error) {
      showAppAlert(error.message || "Login failed.", "error");
    }
  });
}

function initForgotPassword() {
  const form = document.getElementById("forgot-password-form");
  const accountType = document.getElementById("account-type");
  const studentGroup = document.getElementById("student-identity-group");
  const lecturerGroup = document.getElementById("lecturer-identity-group");

  if (!form) return;

  function toggleIdentityFields() {
    const type = accountType ? accountType.value : "";

    if (studentGroup) {
      studentGroup.style.display = type === "student" ? "block" : "none";
    }

    if (lecturerGroup) {
      lecturerGroup.style.display = type === "lecturer" ? "block" : "none";
    }
  }

  if (accountType) {
    accountType.addEventListener("change", toggleIdentityFields);
    toggleIdentityFields();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const type = getInputValue("account-type");
    const studentResetId = getInputValue("student-reset-id").trim().toUpperCase();
    const email = getInputValue("email").trim().toLowerCase();
    const newPassword = getInputValue("new-password");
    const confirmNewPassword = getInputValue("confirm-new-password");

    if (!type || !newPassword || !confirmNewPassword) {
      showAppAlert("Please complete all required fields.", "warning");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      showAppAlert("Passwords do not match.", "error");
      return;
    }

    try {
      if (type === "student") {
        if (!studentResetId) {
          showAppAlert("Please enter your matric number.", "warning");
          return;
        }

        await apiRequest("/auth/students/reset-password", {
          method: "POST",
          body: JSON.stringify({
            matricNumber: studentResetId,
            newPassword
          })
        });

        showAppAlert("Student password reset successful.", "success");
        redirectWithDelay("student-login.html");
        return;
      }

      if (type === "lecturer") {
        if (!email) {
          showAppAlert("Please enter your email address.", "warning");
          return;
        }

        await apiRequest("/auth/lecturers/reset-password", {
          method: "POST",
          body: JSON.stringify({
            email,
            newPassword
          })
        });

        showAppAlert("Lecturer password reset successful.", "success");
        redirectWithDelay("lecturer-login.html");
        return;
      }

      showAppAlert("Please select an account type.", "warning");
    } catch (error) {
      showAppAlert(error.message || "Password reset failed.", "error");
    }
  });
}

/* =========================
   Lecturer Dashboard Helpers
========================= */
async function fetchAttendanceRecordsForSession(sessionId) {
  try {
    const data = await apiRequest(`/attendance/session/${sessionId}`);
    return data.attendanceRecords || [];
  } catch (error) {
    return [];
  }
}

async function fetchAttendanceSummaryForSession(sessionId) {
  try {
    const data = await apiRequest(`/attendance/summary/${sessionId}`);
    return data.summary || {
      total: 0,
      confirmed: 0,
      incomplete: 0,
      expired: 0,
      pending: 0
    };
  } catch (error) {
    return {
      total: 0,
      confirmed: 0,
      incomplete: 0,
      expired: 0,
      pending: 0
    };
  }
}

function normalizeSessionFromBackend(session) {
  return {
    _id: session._id,
    courseCode: session.courseCode,
    courseTitle: session.courseTitle,
    sessionNumber: session.sessionNumber,
    duration: session.duration,
    topic: session.topic || "",
    sessionCode: session.sessionCode,
    createdAt: new Date(session.createdAt || session.startsAt).getTime(),
    expiresAt: new Date(session.expiresAt).getTime(),
    lecturerEmail: session.lecturerEmail,
    lecturerId: session.lecturerId,
    status: session.status,
    endedAt: session.endedAt ? new Date(session.endedAt).getTime() : null,
    endedDate: session.endedAt ? formatDisplayDate(session.endedAt) : "",
    endedTime: session.endedAt ? formatDisplayTime(session.endedAt) : ""
  };
}

async function renderLecturerAttendanceTable() {
  const tableBody = document.getElementById("attendance-report-body");
  if (!tableBody) return;
  const reportTitle = document.getElementById("report-session-title");

  const selectedHistorySession = getSelectedHistorySession();
  const activeSession = getSession();
  const sourceSession = selectedHistorySession || activeSession;

  if (!sourceSession || !sourceSession._id) {
    if (reportTitle) reportTitle.textContent = "Attendance (0)";
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-row">No active or selected session found.</td>
      </tr>
    `;
    return;
  }

  const records = await fetchAttendanceRecordsForSession(sourceSession._id);
  if (reportTitle) reportTitle.textContent = `Attendance (${records.length})`;

  if (!records.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-row">No attendance records yet.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = records
    .map((record, index) => {
      let statusClass = "tag-pending";
      if (record.status === "Confirmed") statusClass = "tag-confirmed";
      if (record.status === "Incomplete") statusClass = "tag-incomplete";
      if (record.status === "Expired") statusClass = "tag-expired";
      const initials = getInitials(record.studentName || record.matricNumber || "Student");

      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="student-cell">
              <span class="student-avatar">${escapeHtml(initials)}</span>
              <strong>${escapeHtml(record.studentName || "Not Available")}</strong>
            </div>
          </td>
          <td>${escapeHtml(record.matricNumber || "Not Available")}</td>
          <td><span class="table-tag ${statusClass}">● ${escapeHtml(record.status || "Pending")}</span></td>
          <td>${escapeHtml(record.submittedAt ? formatDisplayTime(record.submittedAt) : "-")}</td>
          <td class="row-actions">⋮</td>
        </tr>
      `;
    })
    .join("");
}

async function renderLecturerAttendanceStats() {
  const confirmedCountEl = document.getElementById("confirmed-count");
  const totalCountEl = document.getElementById("total-count");
  const incompleteCountEl = document.getElementById("incomplete-count");

  if (!confirmedCountEl || !totalCountEl || !incompleteCountEl) return;

  const selectedHistorySession = getSelectedHistorySession();
  const activeSession = getSession();
  const sourceSession = selectedHistorySession || activeSession;

  if (!sourceSession || !sourceSession._id) {
    confirmedCountEl.textContent = "0";
    totalCountEl.textContent = "0";
    incompleteCountEl.textContent = "0";
    return;
  }

  const summary = await fetchAttendanceSummaryForSession(sourceSession._id);

  confirmedCountEl.textContent = String(summary.confirmed || 0);
  totalCountEl.textContent = String(summary.total || 0);
  incompleteCountEl.textContent = String(summary.incomplete || 0);
}

function renderReportHeader() {
  const titleEl = document.getElementById("report-session-title");
  const subtitleEl = document.getElementById("report-session-subtitle");

  if (!titleEl || !subtitleEl) return;

  const selectedHistorySession = getSelectedHistorySession();
  const activeSession = getSession();

  if (selectedHistorySession) {
    titleEl.textContent = `${selectedHistorySession.courseCode} • Attendance Session ${selectedHistorySession.sessionNumber}`;
    subtitleEl.textContent = `${selectedHistorySession.courseTitle || "No course title"} • History View`;
    return;
  }

  if (activeSession) {
    titleEl.textContent = `${activeSession.courseCode} • Attendance Session ${activeSession.sessionNumber}`;
    subtitleEl.textContent = activeSession.courseTitle || "No course title";
    return;
  }

  titleEl.textContent = "No Active Session";
  subtitleEl.textContent = "Start a session to view attendance records.";
}

function renderSessionHistory() {
  const historyBody = document.getElementById("session-history-body");
  if (!historyBody) return;

  if (!lecturerHistoryCache.length) {
    historyBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">No past sessions yet.</td>
      </tr>
    `;
    return;
  }

  historyBody.innerHTML = lecturerHistoryCache
    .map((session, index) => {
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(session.courseCode || "Not Available")}</td>
          <td>${escapeHtml(session.courseTitle || "Not Available")}</td>
          <td>${escapeHtml(session.sessionNumber || "Not Available")}</td>
          <td>${escapeHtml(session.endedDate || "Not Available")}</td>
          <td>${escapeHtml(session.endedTime || "Not Available")}</td>
          <td>${escapeHtml(session.totalRecords || 0)}</td>
          <td>
            <button
              type="button"
              class="history-view-btn"
              onclick="viewHistorySession(${index})"
            >
              View Report
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function fetchLecturerSessionsAndRender() {
  const lecturer = getCurrentLecturerProfile();
  if (!lecturer?.id) return;

  try {
    const data = await apiRequest(`/sessions/lecturer/${lecturer.id}`);
    const sessions = (data.sessions || []).map(normalizeSessionFromBackend);

    const sessionsWithTotals = await Promise.all(
      sessions.map(async (session) => {
        const summary = await fetchAttendanceSummaryForSession(session._id);
        return {
          ...session,
          totalRecords: summary.total || 0
        };
      })
    );

    lecturerHistoryCache = sessionsWithTotals.filter(
      (session) => session.status === "ended" || session.status === "expired"
    );

    renderSessionHistory();
  } catch (error) {
    lecturerHistoryCache = [];
    renderSessionHistory();
  }
}
async function loadActiveSessionFromBackend() {
  const lecturer = getCurrentLecturerProfile();
  if (!lecturer?.id) return;

  try {
    const data = await apiRequest(`/sessions/active/${lecturer.id}`);
    const session = normalizeSessionFromBackend(data.session);
    saveSession(session);
  } catch (error) {
    clearSession();
  }
}

async function syncCurrentSessionStatus() {
  const session = getSession();
  if (!session?._id) return;

  const lecturer = getCurrentLecturerProfile();
  if (!lecturer?.id) return;

  try {
    const data = await apiRequest(`/sessions/active/${lecturer.id}`);
    const freshSession = normalizeSessionFromBackend(data.session);
    saveSession(freshSession);
  } catch (error) {
    clearSession();
  }
}

window.viewHistorySession = async function (index) {
  const selected = lecturerHistoryCache[index];
  if (!selected) return;

  saveSelectedHistorySession(selected);
  renderReportHeader();
  await renderLecturerAttendanceTable();
  await renderLecturerAttendanceStats();
};

/* =========================
   Lecturer Dashboard Logic
========================= */
function initLecturerDashboard() {
  const startBtn = document.querySelector(".session-form .primary-btn");
  const clearBtn = document.querySelector(".session-form .secondary-btn");
  const endBtn = document.querySelector(".danger-btn");

  const courseCodeInput = document.getElementById("course-code");
  const courseTitleInput = document.getElementById("course-title");
  const sessionNumberInput = document.getElementById("session-number");
  const durationInput = document.getElementById("duration");
  const topicInput = document.getElementById("topic");

  const courseText = document.querySelector(".meta-item strong");
  const sessionText = document.querySelectorAll(".meta-item strong")[1];
  const sessionCodeText = document.querySelector(".session-code-box h3");
  const countdownText = document.querySelector(".countdown-head span:last-child");
  const progressFill = document.querySelector(".progress-fill");
  const liveCourseTitle = document.getElementById("live-course-title");
  const liveCourseSubtitle = document.getElementById("live-course-subtitle");
  const liveStartedAt = document.getElementById("live-started-at");

  if (!startBtn || !courseCodeInput || !courseTitleInput) return;

  clearSelectedHistorySession();

  function renderSessionOnDashboard() {
    const session = getSession();

    if (!session) {
      if (courseText) courseText.textContent = "Not Set";
      if (sessionText) sessionText.textContent = "Not Set";
      if (sessionCodeText) sessionCodeText.textContent = "------";
      if (countdownText) countdownText.textContent = "00:00";
      if (progressFill) progressFill.style.width = "0%";
      if (liveCourseTitle) liveCourseTitle.textContent = "No Active Session";
      if (liveCourseSubtitle) liveCourseSubtitle.textContent = "Create a session to begin attendance tracking.";
      if (liveStartedAt) liveStartedAt.textContent = "Not Set";
      return;
    }

    if (courseText) courseText.textContent = session.courseCode;
    if (sessionText) sessionText.textContent = `${session.sessionNumber} Attendance`;
    if (sessionCodeText) sessionCodeText.textContent = session.sessionCode;
    if (liveCourseTitle) liveCourseTitle.textContent = session.courseTitle || "Untitled Course";
    if (liveCourseSubtitle) liveCourseSubtitle.textContent = `${session.courseCode} - Lecture`;
    if (liveStartedAt) liveStartedAt.textContent = `${formatDisplayTime(session.createdAt || Date.now())}, ${formatDisplayDate(session.createdAt || Date.now())}`;

    updateDashboardCountdown();
  }

  function updateDashboardCountdown() {
    const session = getSession();
    if (!session) return;

    const timeLeft = session.expiresAt - serverNow();

    if (timeLeft <= 0) {
      if (countdownText) countdownText.textContent = "00:00";
      if (progressFill) progressFill.style.width = "0%";
      return;
    }

    if (countdownText) {
      countdownText.textContent = formatTimeRemaining(timeLeft);
    }

    const totalDuration = session.duration * 1000;
    const percentage = totalDuration > 0 ? (timeLeft / totalDuration) * 100 : 0;

    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
  }

  async function refreshActiveDashboardData() {
    await syncCurrentSessionStatus();
    renderSessionOnDashboard();
    renderReportHeader();
    await renderLecturerAttendanceTable();
    await renderLecturerAttendanceStats();
    await fetchLecturerSessionsAndRender();
  }

  startBtn.addEventListener("click", async () => {
    const courseCode = courseCodeInput.value.trim().toUpperCase();
    const courseTitle = courseTitleInput.value.trim();
    const sessionNumber = sessionNumberInput.value.trim();
    const duration = Number(durationInput.value);
    const topic = topicInput.value.trim();

    if (!courseCode || !courseTitle || !sessionNumber) {
      showAppAlert(
        "Please fill in course code, course title, and attendance session number.",
        "warning"
      );
      return;
    }

    const lecturer = getCurrentLecturerProfile();

    if (!lecturer || !lecturer.id || !lecturer.email) {
      showAppAlert("Lecturer session not found. Please login again.", "error");
      return;
    }

    clearSelectedHistorySession();

    try {
      const data = await apiRequest("/sessions/create", {
        method: "POST",
        body: JSON.stringify({
          lecturerId: lecturer.id,
          lecturerEmail: lecturer.email,
          courseCode,
          courseTitle,
          sessionNumber,
          duration,
          topic
        })
      });

      const sessionData = normalizeSessionFromBackend(data.session);

      saveSession(sessionData);
      clearResultData();

      showAppAlert("Attendance session started successfully.", "success");

      await refreshActiveDashboardData();
    } catch (error) {
      showAppAlert(error.message || "Unable to connect to backend.", "error");
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      courseCodeInput.value = "";
      courseTitleInput.value = "";
      sessionNumberInput.value = "";
      durationInput.value = "60";
      topicInput.value = "";
      showAppAlert("Session form cleared.", "info");
    });
  }

  if (endBtn) {
    endBtn.addEventListener("click", async () => {
      const activeSession = getSession();

      if (!activeSession || !activeSession._id) {
        showAppAlert("There is no active session to end.", "warning");
        return;
      }

      try {
        await apiRequest(`/sessions/end/${activeSession._id}`, {
          method: "PATCH"
        });

        incrementHistoryBadgeCount();

        clearSession();
        clearResultData();
        clearSelectedHistorySession();

        showAppAlert("Attendance session ended.", "success");

        renderSessionOnDashboard();
        renderReportHeader();
        await renderLecturerAttendanceTable();
        await renderLecturerAttendanceStats();
        await fetchLecturerSessionsAndRender();
      } catch (error) {
        showAppAlert(error.message || "Unable to connect to backend.", "error");
      }
    });
  }

  renderSessionOnDashboard();
  renderReportHeader();

  loadActiveSessionFromBackend().then(async () => {
    await refreshActiveDashboardData();
  });

  // The countdown has its own one-second timer. It used to share the 3-second
  // timer below, which made it jump three seconds at a time.
  clearInterval(dashboardCountdownInterval);
  dashboardCountdownInterval = setInterval(updateDashboardCountdown, 1000);

  clearInterval(dashboardInterval);

  dashboardInterval = setInterval(async () => {
    const activeSession = getSession();
    if (activeSession && !getSelectedHistorySession()) {
      await renderLecturerAttendanceTable();
      await renderLecturerAttendanceStats();
    }
  }, 3000);
}

/* =========================
   Student Verification Logic
========================= */
function initStudentVerification() {
  const sessionCodeInput = document.getElementById("session-code");
  const verifyBtn = document.querySelector(".verification-form .primary-btn");

  if (!sessionCodeInput || !verifyBtn) return;

  const countdownCard = document.getElementById("countdown-card");
  const revealedSessionInfo = document.getElementById("revealed-session-info");

  const revealedSessionTitle = document.getElementById("revealed-session-title");
  const revealedCourseCode = document.getElementById("revealed-course-code");
  const revealedCourseTitle = document.getElementById("revealed-course-title");
  const revealedSessionNumber = document.getElementById("revealed-session-number");
  const revealedDuration = document.getElementById("revealed-duration");

  const countdownText = document.querySelector(".countdown-head span:last-child");
  const progressFill = document.querySelector(".progress-fill");

  const pendingPanel = document.querySelector(".pending-panel");
  const successPanel = document.querySelector(".success-panel");
  const incompletePanel = document.querySelector(".incomplete-panel");
  const expiredPanel = document.querySelector(".expired-panel");
  const leaveWarningModal = document.getElementById("leave-warning-modal");
  const stayOnPageBtn = document.getElementById("stay-on-page-btn");

  function hideAllPanels() {
    [pendingPanel, successPanel, incompletePanel, expiredPanel].forEach((panel) => {
      if (panel) panel.style.display = "none";
    });
  }

  function showPanel(panel) {
    hideAllPanels();
    if (panel) panel.style.display = "flex";
  }

  function hideSessionBlocks() {
    if (revealedSessionInfo) revealedSessionInfo.style.display = "none";
    if (countdownCard) countdownCard.style.display = "none";
  }

  function showSessionBlocks() {
    if (revealedSessionInfo) revealedSessionInfo.style.display = "block";
    if (countdownCard) countdownCard.style.display = "block";
  }

  hideAllPanels();
  hideSessionBlocks();

  const studentProfile = getCurrentStudentProfile();

  if (!studentProfile) {
    showAppAlert("No student account found. Please log in first.", "error");
    redirectWithDelay("student-login.html");
    return;
  }

  let verificationStarted = false;
  let hideTimer = null;
  let finalizing = false;
  const HIDE_GRACE_PERIOD = 3000;

  async function handleVerificationSuccess(context) {
    if (finalizing) return;

    finalizing = true;
    clearInterval(window.heartbeatInterval);
    showPanel(successPanel);

    saveResultData({
      studentName: studentProfile.fullName || "Not Available",
      matricNumber: studentProfile.matricNumber || "Not Available",
      department: studentProfile.department || "Not Available",
      level: studentProfile.level || "Not Available",
      courseCode: context.session.courseCode || "Not Available",
      courseTitle: context.session.courseTitle || "Not Available",
      sessionNumber: context.session.sessionNumber || "Not Available",
      submittedAt: context.submittedAt || getCurrentTimeString()
    });

    clearVerificationContext();
    redirectWithDelay("student-success.html", 700);
  }
  async function handleVerificationIncomplete(context) {
    if (finalizing) return;

    finalizing = true;
    clearInterval(window.heartbeatInterval);
    showPanel(incompletePanel);

    saveResultData({
      studentName: studentProfile.fullName || "Not Available",
      matricNumber: studentProfile.matricNumber || "Not Available",
      department: studentProfile.department || "Not Available",
      level: studentProfile.level || "Not Available",
      courseCode: context.session.courseCode || "Not Available",
      courseTitle: context.session.courseTitle || "Not Available",
      sessionNumber: context.session.sessionNumber || "Not Available",
      submittedAt: context.submittedAt || getCurrentTimeString()
    });

    clearVerificationContext();
    redirectWithDelay("student-incomplete.html", 700);
  }

  // At the end of the countdown, ask the server for the verdict. The server is
  // the one that knows whether the student stayed, so "still pending" or a failed
  // request means ask again, not "Incomplete". Only an answer from the server
  // saying Incomplete (or Expired) ends in the Incomplete screen.
  async function confirmWithServer(context, attempt = 0) {
    if (finalizing) return;

    try {
      const data = await sendHeartbeat(context.attendanceId);

      if (data.status === "Confirmed") {
        await handleVerificationSuccess(context);
        return;
      }

      if (data.status === "Incomplete" || data.status === "Expired") {
        await handleVerificationIncomplete(context);
        return;
      }
    } catch (error) {
      const message = (error.message || "").toLowerCase();

      if (message.includes("incomplete") || message.includes("inactivity")) {
        await handleVerificationIncomplete(context);
        return;
      }
    }

    // The reply may have just corrected our clock. If there is still time left on
    // the server's clock, go back to counting down instead of waiting here.
    const stillLeftMs = new Date(context.session.expiresAt).getTime() - serverNow();

    if (stillLeftMs > 0) {
      clearInterval(verificationInterval);
      updateStudentCountdown();
      verificationInterval = setInterval(updateStudentCountdown, 1000);
      return;
    }

    if (attempt < 30) {
      setTimeout(() => confirmWithServer(context, attempt + 1), 1000);
    } else {
      showAppAlert(
        "We could not reach the server to confirm your attendance. Stay on this page and tell your lecturer.",
        "error"
      );
    }
  }

  function updateStudentCountdown() {
    const context = getVerificationContext();
    if (!context) return;

    const timeLeft = new Date(context.session.expiresAt).getTime() - serverNow();

    if (timeLeft <= 0) {
      if (countdownText) countdownText.textContent = "00:00";
      if (progressFill) progressFill.style.width = "0%";

      clearInterval(verificationInterval);
      confirmWithServer(context);
      return;
    }

    if (countdownText) {
      countdownText.textContent = formatTimeRemaining(timeLeft);
    }

    const totalDuration = Number(context.session.duration) * 1000;
    const percentage = totalDuration > 0 ? (timeLeft / totalDuration) * 100 : 0;

    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
  }
  if (!navigator.onLine) {
  showAppAlert("Connection lost. You may lose attendance.", "warning");
}
  async function runHeartbeat() {
    const context = getVerificationContext();
    if (!context?.attendanceId || finalizing) return;

    if (!navigator.onLine) {
      showAppAlert("Connection lost. Stay on this page while reconnecting.", "warning");
      return;
    }

    try {
      const data = await sendHeartbeat(context.attendanceId);
      if (data.status === "Confirmed") {
        await handleVerificationSuccess(context);
      }
    } catch (error) {
      const message = error.message || "";
      if (
        message.toLowerCase().includes("incomplete") ||
        message.toLowerCase().includes("inactivity")
      ) {
        await handleVerificationIncomplete(context);
      }
    }
  }

  verifyBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const enteredCode = sessionCodeInput.value.trim().toUpperCase();

    if (!enteredCode) {
      showAppAlert("Please enter the session code.", "warning");
      return;
    }

    try {
      const sessionData = await apiRequest(`/sessions/code/${enteredCode}`);
      const session = sessionData.session;

      if (revealedSessionTitle) {
        revealedSessionTitle.textContent = `${session.courseCode} • Attendance Session ${session.sessionNumber}`;
      }
      if (revealedCourseCode) {
        revealedCourseCode.textContent = session.courseCode;
      }
      if (revealedCourseTitle) {
        revealedCourseTitle.textContent = session.courseTitle;
      }
      if (revealedSessionNumber) {
        revealedSessionNumber.textContent = `${session.sessionNumber} Attendance`;
      }
      if (revealedDuration) {
        revealedDuration.textContent = getDurationLabel(session.duration);
      }

      const attendanceData = await apiRequest("/attendance/submit", {
        method: "POST",
        body: JSON.stringify({
          sessionCode: enteredCode,
          matricNumber: studentProfile.matricNumber
        })
      });

      const submittedAt = getCurrentTimeString();

      saveVerificationContext({
        attendanceId: attendanceData.attendance._id,
        sessionId: attendanceData.session.id,
        session: {
          ...attendanceData.session,
          expiresAt: session.expiresAt
        },
        submittedAt
      });

      saveResultData({
        studentName: studentProfile.fullName,
        matricNumber: studentProfile.matricNumber,
        department: studentProfile.department,
        level: studentProfile.level,
        courseCode: attendanceData.session.courseCode,
        courseTitle: attendanceData.session.courseTitle,
        sessionNumber: attendanceData.session.sessionNumber,
        submittedAt
      });

      showSessionBlocks();
      showPanel(pendingPanel);

      verificationStarted = true;
      // 🔥 START HEARTBEAT
      finalizing = false;

      verifyBtn.textContent = "Verification Started";
      verifyBtn.disabled = true;
      sessionCodeInput.disabled = true;

      showAppAlert("Correct code entered. Stay on this page until the countdown ends.", "success");

      clearInterval(verificationInterval);
      updateStudentCountdown();
      verificationInterval = setInterval(updateStudentCountdown, 1000);

      clearInterval(window.heartbeatInterval);
      await runHeartbeat();
      window.heartbeatInterval = setInterval(runHeartbeat, 2000);
    } catch (error) {
      const message = error.message || "Unable to verify session.";
      if (message.toLowerCase().includes("expired") || message.toLowerCase().includes("active")) {
        showPanel(expiredPanel);
      }
      showAppAlert(message, "error");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!verificationStarted) return;

    if (document.hidden) {
      hideTimer = setTimeout(async () => {
        const context = getVerificationContext();
        if (context) {
          showAppAlert("You left the verification page. Backend validation is checking your status.", "warning");
          await handleVerificationIncomplete(context);
        }
      }, HIDE_GRACE_PERIOD);
    } else if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!verificationStarted || finalizing) return;

    event.preventDefault();
    event.returnValue = "Leaving for more than 3 seconds will invalidate your attendance.";
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link || !verificationStarted || finalizing) return;

    event.preventDefault();
    if (leaveWarningModal) {
      leaveWarningModal.classList.add("is-visible");
    } else {
      showAppAlert("Stay on this page until the timer ends.", "warning");
    }
  });

  if (stayOnPageBtn && leaveWarningModal) {
    stayOnPageBtn.addEventListener("click", () => {
      leaveWarningModal.classList.remove("is-visible");
    });
  }
}

/* =========================
   Result Pages
========================= */
function initResultPages() {
  const result = getResultData();
  if (!result) return;

  const courseCodeEls = document.querySelectorAll("[data-result='course-code']");
  const courseTitleEls = document.querySelectorAll("[data-result='course-title']");
  const sessionNumberEls = document.querySelectorAll("[data-result='session-number']");
  const submittedAtEls = document.querySelectorAll("[data-result='submitted-at']");
  const studentNameEls = document.querySelectorAll("[data-result='student-name']");
  const matricEls = document.querySelectorAll("[data-result='matric-number']");
  const departmentEls = document.querySelectorAll("[data-result='department']");
  const levelEls = document.querySelectorAll("[data-result='level']");

  courseCodeEls.forEach((el) => {
    el.textContent = result.courseCode || "Not Available";
  });

  courseTitleEls.forEach((el) => {
    el.textContent = result.courseTitle || "Not Available";
  });

  sessionNumberEls.forEach((el) => {
    el.textContent = result.sessionNumber ? `${result.sessionNumber} Attendance` : "Not Available";
  });

  submittedAtEls.forEach((el) => {
    el.textContent = result.submittedAt || "Not Available";
  });

  studentNameEls.forEach((el) => {
    el.textContent = result.studentName || "Not Available";
  });

  matricEls.forEach((el) => {
    el.textContent = result.matricNumber || "Not Available";
  });

  departmentEls.forEach((el) => {
    el.textContent = result.department || "Not Available";
  });

  levelEls.forEach((el) => {
    el.textContent = result.level ? `${result.level} Level` : "Not Available";
  });
}

/* =========================
   Student Settings
========================= */
function initStudentSettings() {
  const form = document.getElementById("student-settings-form");
  const profile = getCurrentStudentProfile();

  const fullNameEl = document.getElementById("profile-full-name");
  const matricEl = document.getElementById("profile-matric");
  const deptEl = document.getElementById("profile-department");
  const levelEl = document.getElementById("profile-level");
  const fullNameInput = document.getElementById("settings-full-name");
  const matricInput = document.getElementById("settings-matric-number");
  const departmentInput = document.getElementById("settings-department");
  const levelSelect = document.getElementById("settings-level");

  if (!form || !fullNameEl || !profile) return;

  fullNameEl.textContent = profile.fullName;
  matricEl.textContent = profile.matricNumber;
  deptEl.textContent = profile.department;
  levelEl.textContent = `${profile.level} Level`;
  if (fullNameInput) fullNameInput.value = profile.fullName || "";
  if (matricInput) matricInput.value = profile.matricNumber || "";
  if (departmentInput) departmentInput.value = profile.department || "";
  levelSelect.value = profile.level;

  form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fullName = fullNameInput ? fullNameInput.value.trim() : profile.fullName;
  const matricNumber = matricInput ? matricInput.value.trim().toUpperCase() : profile.matricNumber;
  const department = departmentInput ? departmentInput.value.trim() : profile.department;
  const newLevel = levelSelect.value;

  if (!fullName || !matricNumber || !department || !newLevel) {
    showAppAlert("Please complete all profile fields.", "warning");
    return;
  }

  try {
    const data = await apiRequest("/auth/students/update", {
      method: "PATCH",
      body: JSON.stringify({
        fullName,
        matricNumber,
        department,
        level: newLevel
      })
    });

    if (data.token) {
      localStorage.setItem(STORAGE_KEYS.token, data.token);
    }

    setCurrentStudentProfile(data.student);

    showAppAlert("Level updated successfully.", "success");

    fullNameEl.textContent = data.student.fullName;
    matricEl.textContent = data.student.matricNumber;
    deptEl.textContent = data.student.department;
    levelEl.textContent = `${data.student.level} Level`;
    renderStudentProfileIdentity();
  } catch (error) {
    showAppAlert(error.message, "error");
  }
});
}

function initLecturerSettings() {
  const form = document.getElementById("lecturer-settings-form");
  const profile = getCurrentLecturerProfile();

  if (!form) return;

  if (!profile) {
    showAppAlert("Please log in as a lecturer first.", "warning");
    redirectWithDelay("lecturer-login.html");
    return;
  }

  const fullNameView = document.getElementById("lecturer-profile-full-name");
  const emailView = document.getElementById("lecturer-profile-email");
  const fullNameInput = document.getElementById("lecturer-settings-full-name");
  const emailInput = document.getElementById("lecturer-settings-email");

  if (fullNameView) fullNameView.textContent = profile.fullName || "Not set";
  if (emailView) emailView.textContent = profile.email || "Not set";
  if (fullNameInput) fullNameInput.value = profile.fullName || "";
  if (emailInput) emailInput.value = profile.email || "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = fullNameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();

    if (!fullName || !email) {
      showAppAlert("Please complete all lecturer profile fields.", "warning");
      return;
    }

    try {
      const data = await apiRequest("/auth/lecturers/update", {
        method: "PATCH",
        body: JSON.stringify({ fullName, email })
      });

      if (data.token) {
        localStorage.setItem(STORAGE_KEYS.token, data.token);
      }

      setCurrentLecturerProfile(data.lecturer);
      if (fullNameView) fullNameView.textContent = data.lecturer.fullName;
      if (emailView) emailView.textContent = data.lecturer.email;
      renderLecturerProfileIdentity();
      showAppAlert("Lecturer profile updated successfully.", "success");
    } catch (error) {
      showAppAlert(error.message || "Unable to update lecturer profile.", "error");
    }
  });
}

/* =========================
   Logout / Protection
========================= */
function initStudentLogout() {
  const logoutBtn = document.getElementById("student-logout-btn");
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", () => {
    clearCurrentStudent();
  });
}

function initLecturerLogout() {
  const logoutBtn = document.getElementById("lecturer-logout-btn");
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", () => {
    clearCurrentLecturer();
  });
}

function protectLecturerDashboard() {
  if (!document.getElementById("course-code")) return;

  const currentLecturer = getCurrentLecturerProfile();
  if (!currentLecturer) {
    showAppAlert("Please log in as a lecturer first.", "warning");
    redirectWithDelay("lecturer-login.html");
  }
}

function protectStudentPages() {
  const needsStudent =
    document.getElementById("session-code") || document.getElementById("student-settings-form");

  if (!needsStudent) return;

  const currentStudent = getCurrentStudentProfile();
  if (!currentStudent) {
    showAppAlert("Please log in as a student first.", "warning");
    redirectWithDelay("student-login.html");
  }
}

/* =========================
   Report Download
========================= */
async function downloadAttendanceReport() {
  const selectedHistorySession = getSelectedHistorySession();
  const activeSession = getSession();
  const session = selectedHistorySession || activeSession;

  if (!session || !session._id) {
    showAppAlert("No active or selected session found to download.", "warning");
    return;
  }

  const records = await fetchAttendanceRecordsForSession(session._id);

  if (!records.length) {
    showAppAlert("No attendance records available for this session.", "warning");
    return;
  }

  const headers = [
    "S/N",
    "Full Name",
    "Department",
    "Level",
    "Matric Number",
    "Status",
    "Time Submitted"
  ];

  const rows = records.map((record, index) => [
    index + 1,
    record.studentName || "",
    record.department || "",
    record.level ? `${record.level} Level` : "",
    record.matricNumber || "",
    record.status || "",
    record.submittedAt ? formatDisplayTime(record.submittedAt) : ""
  ]);

  const reportHeader = [
    [`Course Code: ${session.courseCode || ""}`],
    [`Course Title: ${session.courseTitle || ""}`],
    [`Session Number: ${session.sessionNumber || ""}`],
    [""]
  ];

  const csvContent = [...reportHeader, headers, ...rows]
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${session.courseCode}_Attendance_Session_${session.sessionNumber}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  showAppAlert("Attendance report downloaded.", "success");
}

function initDownloadReport() {
  const downloadBtn = document.getElementById("download-report-btn");
  if (!downloadBtn) return;

  downloadBtn.addEventListener("click", () => {
    downloadAttendanceReport();
  });
}

function initAttendanceSearch() {
  const searchInput = document.getElementById("attendance-search");
  const tableBody = document.getElementById("attendance-report-body");

  if (!searchInput || !tableBody) return;

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    const rows = tableBody.querySelectorAll("tr");

    rows.forEach((row) => {
      if (row.querySelector(".empty-row")) return;
      row.style.display = row.textContent.toLowerCase().includes(query) ? "" : "none";
    });
  });
}

/* =========================
   Session History UI
========================= */
function initSessionHistoryToggle() {
  const toggleBtn = document.getElementById("history-toggle-btn");
  const historySection = document.getElementById("history-section");
  const badge = document.getElementById("history-badge");

  if (!toggleBtn || !historySection || !badge) return;

  function renderBadge() {
    const count = getHistoryBadgeCount();
    badge.textContent = String(count);
    badge.style.display = count > 0 ? "inline-flex" : "none";
  }

  toggleBtn.addEventListener("click", () => {
    const isHidden = historySection.style.display === "none";

    if (isHidden) {
      historySection.style.display = "block";
      setTimeout(() => {
        historySection.classList.add("active");
      }, 10);

      resetHistoryBadgeCount();
      renderBadge();
    } else {
      historySection.classList.remove("active");
      setTimeout(() => {
        historySection.style.display = "none";
      }, 300);
    }
  });

  renderBadge();
}

function initBackToActiveSession() {
  const backBtn = document.getElementById("back-to-active-btn");
  if (!backBtn) return;

  backBtn.addEventListener("click", async () => {
    clearSelectedHistorySession();
    renderReportHeader();
    await renderLecturerAttendanceTable();
    await renderLecturerAttendanceStats();
  });
}

/* =========================
   Micro Interactions
========================= */
function initPremiumMicroInteractions() {
  const clickableItems = document.querySelectorAll(
    ".primary-btn, .secondary-btn, .ghost-btn, .status-card, .quick-stat-card, .feature-card"
  );

  clickableItems.forEach((item) => {
    item.addEventListener("mouseenter", () => {
      item.style.willChange = "transform";
    });

    item.addEventListener("mouseleave", () => {
      item.style.willChange = "auto";
    });
  });
}

/* =========================
   App Bootstrap
========================= */
document.addEventListener("DOMContentLoaded", () => {
  applySavedTheme();
  protectLecturerDashboard();
  protectStudentPages();

  if (document.getElementById("student-register-form")) {
    initStudentRegistration();
  }

  if (document.getElementById("student-login-form")) {
    initStudentLogin();
  }

  if (document.getElementById("lecturer-register-form")) {
    initLecturerRegistration();
  }

  if (document.getElementById("lecturer-login-form")) {
    initLecturerLogin();
  }

  if (document.getElementById("forgot-password-form")) {
    initForgotPassword();
  }

  if (document.getElementById("student-settings-form")) {
    initStudentSettings();
  }

  if (document.getElementById("lecturer-settings-form")) {
    initLecturerSettings();
  }

  if (document.getElementById("course-code")) {
    initLecturerDashboard();
  }

  if (document.getElementById("session-code")) {
    initStudentVerification();
  }

  initResultPages();
  initPremiumMicroInteractions();
  initDownloadReport();
  initAttendanceSearch();
  initSessionHistoryToggle();
  initBackToActiveSession();
  initThemeToggle();
  initStudentLogout();
  initLecturerLogout();
  initPasswordToggle();

  renderLecturerProfileIdentity();
  renderStudentProfileIdentity();
  initPwaInstallNotice();
});

let deferredInstallPrompt = null;

function isMobileBrowser() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function initPwaInstallNotice() {
  const banner = document.createElement("div");
  banner.id = "pwa-install-banner";
  banner.className = "install-banner hidden";
  banner.innerHTML = `
    <div class="install-banner-inner">
      <div>
        <strong>Install AttendSure</strong>
        <p id="install-banner-message">Add this app to your home screen for faster access and offline support.</p>
      </div>
      <div class="install-banner-actions">
        <button id="install-app-btn" class="primary-btn">Install</button>
        <button id="dismiss-install-btn" class="ghost-btn">Dismiss</button>
      </div>
    </div>
  `;

  document.body.prepend(banner);

  const installButton = banner.querySelector("#install-app-btn");
  const dismissButton = banner.querySelector("#dismiss-install-btn");
  const installMessage = banner.querySelector("#install-banner-message");

  function showBanner(message, showButton = true) {
    installMessage.textContent = message;
    installButton.style.display = showButton ? "inline-flex" : "none";
    if (!showButton) {
      installButton.textContent = "Use browser menu";
    }
    banner.classList.remove("hidden");
    banner.classList.add("visible");
  }

  function hideBanner() {
    banner.classList.remove("visible");
    banner.classList.add("hidden");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showBanner("Install AttendSure to your home screen for faster access and offline support.", true);
  });

  installButton.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      hideBanner();
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === "accepted") {
        showAppAlert("Install completed. Open AttendSure from your home screen.", "success");
      } else {
        showAppAlert("Install cancelled. You can install later from your browser menu.", "info");
      }
      deferredInstallPrompt = null;
      return;
    }

    showAppAlert("Use your browser menu and choose 'Add to Home screen' to install the app.", "info");
  });

  dismissButton.addEventListener("click", hideBanner);

  window.addEventListener("appinstalled", () => {
    showAppAlert("AttendSure has been installed.", "success");
    hideBanner();
  });

  window.addEventListener("load", () => {
    setTimeout(() => {
      if (!deferredInstallPrompt && isMobileBrowser()) {
        showBanner(
          "If direct install is unavailable, use your browser menu and choose 'Add to Home screen'.",
          false
        );
      }
    }, 1200);
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("Service Worker Registered"))
      .catch((err) => console.log("SW failed:", err));
  });
}
// 🔥 NETWORK STATUS
window.addEventListener("offline", () => {
  showAppAlert("You are offline. Stay on this page.", "warning");
});

window.addEventListener("online", () => {
  showAppAlert("Back online. Syncing...", "success");
});


