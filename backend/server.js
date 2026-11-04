const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const { finalizeDueSessions } = require("./controllers/attendanceController");

dotenv.config();
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://attendsure.netlify.app",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("AttendSure backend is running.");
});

app.use("/api/auth", authRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/attendance", attendanceRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Finish sessions whose time is up, even if nobody is looking at the dashboard.
setInterval(finalizeDueSessions, 2000);
