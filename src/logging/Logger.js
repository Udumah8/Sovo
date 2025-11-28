import winston from 'winston';

/**
 * Application Logger
 */
export class Logger {
  constructor() {
    // Configure Winston logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({ filename: 'bot.log' })
      ]
    });
  }

  /**
   * Logs an info message
   * @param {string} message 
   * @param {Object} [meta] 
   */
  info(message, meta) {
    this.logger.info(message, meta);
  }

  /**
   * Logs a warning message
   * @param {string} message 
   * @param {Object} [meta] 
   */
  warn(message, meta) {
    this.logger.warn(message, meta);
  }

  /**
   * Logs an error message
   * @param {string} message 
   * @param {Object} [meta] 
   */
  error(message, meta) {
    this.logger.error(message, meta);
  }
}