// backend/server.js
"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

// ✅ Always load backend/.env (even if you run node from project root)
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { notFound, errorHandler } = require("./middleware/errorHandler");
const pool = require("./config/database");

const adminRoutes = require("./routes/admin.routes");
const visitorRoutes = require("./routes/visitor.routes");
const plotRoutes = require("./routes/plot.routes");

// ✅ IMPORTANT: THIS FIXES /api/auth/login 404
const authRoutes = require("./routes/auth.routes");

/**
 * ✅ Serve uploads from backend/uploads
 * URLs like: /uploads/plots/<filename>
 */
const UPLOADS_DIR = path.join(__dirname, "uploads");

// Optional combined router (if you have backend/routes/index.js)
let api = null;
try {
  api = require("./routes");
} catch (e) {
  console.log("[SERVER] ./routes index not found (ok):", e.message);
}

const app = express();

// ✅ helpful debug
console.log("[SERVER] NODE_ENV:", process.env.NODE_ENV);
console.log("[SERVER] PORT:", process.env.PORT);
console.log("[SERVER] JWT_SECRET loaded?", !!process.env.JWT_SECRET);

// Catch crashes so you SEE them
process.on("unhandledRejection", (err) => {
  console.error("[FATAL] unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
});

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

// ✅ CORS (dev-safe)
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ EXACT REQUEST LOGS (so you know what path is really being hit)
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`--> ${req.method} ${req.originalUrl}`);
  console.log("    host:", req.headers.host);
  console.log("    origin:", req.headers.origin);
  console.log("    referer:", req.headers.referer);

  res.on("finish", () => {
    console.log(
      `<-- ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`
    );
  });

  next();
});

// morgan (optional, keep if you like)
app.use(morgan("dev"));

/**
 * ✅ uploads
 * IMPORTANT: multer must save inside backend/uploads/...
 */
app.use(
  "/uploads",
  express.static(UPLOADS_DIR, {
    setHeaders(res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      ok: true,
      message: "✅ API + DB connection working",
      time: result.rows[0].now,
    });
  } catch (err) {
    console.error("DB health check error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ✅ API routes
 */
app.use("/api/auth", authRoutes); // ✅ now POST /api/auth/login will exist
app.use("/api/admin", adminRoutes);
app.use("/api/visitor", visitorRoutes);
app.use("/api/plot", plotRoutes);

// Optional combined router (if you really use it)
if (api) app.use("/api", api);

/**
 * ✅ OPTIONAL: dump registered routes (set env DUMP_ROUTES=1)
 * Helps verify that /api/auth/login is really mounted.
 */
function dumpRoutes(app) {
  const routes = [];
  const walk = (stack, prefix = "") => {
    stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase())
          .join(", ");
        routes.push({ methods, path: prefix + layer.route.path });
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    });
  };

  if (app._router?.stack) walk(app._router.stack, "");
  console.log("=== REGISTERED ROUTES (best-effort) ===");
  console.table(routes);
}

if (String(process.env.DUMP_ROUTES || "") === "1") {
  dumpRoutes(app);
}

/**
 * ✅ 404 logger BEFORE your notFound handler
 * (so you see exactly which route is missing)
 */
app.use((req, _res, next) => {
  console.warn("!!! 404 ROUTE NOT FOUND !!!");
  console.warn("method:", req.method);
  console.warn("url:", req.originalUrl);
  console.warn("host:", req.headers.host);
  console.warn("origin:", req.headers.origin);
  next();
});

// 404 + error handlers
app.use(notFound);
app.use(errorHandler);

// ✅ IMPORTANT: force listen on 5000 if env missing
const PORT = Number(process.env.PORT) || 5000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on http://127.0.0.1:${PORT}`);
});

server.on("error", (err) => {
  console.error("[LISTEN ERROR]", err);
});
