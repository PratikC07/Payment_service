import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { httpLogger } from "./utils/loggers.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import adminRoutes from "./routes/admin.routes.js";
import planRoutes from "./routes/plan.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import deviceRoutes from "./routes/device.routes.js";
import cors, { type CorsOptions } from "cors";
import featureRoutes from "./routes/feature.routes.js";
import { internalAuth } from "./middlewares/internalAuth.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";

dotenv.config();

const app = express();

// 1. MUST ADD THIS: Tell Express it is behind DigitalOcean's proxy
app.set("trust proxy", 1);

// 2. MUST ADD THIS: A root route so DigitalOcean knows the app is healthy
app.get("/", (req, res) => {
  res.status(200).send("Payment Service is Live");
});

const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "x-internal-api-key",
    "x-user-id",
    "Idempotency-Key",
  ],
};

// Cors Middleware
app.use(cors(corsOptions));

// Security Middlewares
app.use(helmet());

app.use(
  "/api/webhooks",
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
  webhookRoutes,
);

// Rate Limiting Middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});
app.use(limiter);

// Built-in body parser for JSON
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString(); // Save the raw text string for webhook crypto verification
    },
  }),
);

// Logging Middleware
app.use(httpLogger);

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
  } catch {
    res
      .status(503)
      .json({ status: "DOWN", timestamp: new Date().toISOString() });
  }
});

app.use(internalAuth);
app.use("/api/admin", adminRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/features", featureRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/devices", deviceRoutes);

app.use(errorHandler);

export default app;
