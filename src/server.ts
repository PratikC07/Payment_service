import SmeeClient from "smee-client";
import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { logger } from "./utils/loggers.js";

const smee = new SmeeClient({
  source: "https://smee.io/MT1StpPiFubalvK",
  target: "http://localhost:3000/api/webhooks/razorpay",
  logger: console,
});

const startServer = async () => {
  try {
    let events: any;

    // if (env.NODE_ENV === "development") {
    //   logger.info("Starting Smee client for local webhook forwarding");
    //   events = smee.start();
    // }

    // Connect to database
    await prisma.$connect();
    logger.info("Connected to database");

    // Start server
    const port = Number(env.PORT) || 8080;
    const server = app.listen(port, "0.0.0.0", () => {
      logger.info(
        `🚀 Payment Service running on port ${port} (bound to 0.0.0.0)`,
      );
    });

    // Shutdown server
    const shutdown = async (signal: string) => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        logger.info("HTTP server closed.");
        await prisma.$disconnect();
        logger.info("PostgreSQL connection closed.");
        // if (events) {
        //   events.close();
        //   logger.info("Smee client closed.");
        // }
        process.exit(0);
      });
    };

    // Shutdown server on SIGINT and SIGTERM
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

startServer();
