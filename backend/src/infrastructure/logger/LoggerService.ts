import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "Youtube Playlist Downloader" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        winston.format.prettyPrint({ colorize: false }),
      ),
    }),
  ],
});

export default { logger };
