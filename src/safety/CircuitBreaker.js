/**
 * Circuit Breaker System
 */
export class CircuitBreaker {
  /**
   * @param {ConfigManager} config
   * @param {Logger} logger
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.consecutiveFailures = 0;
    this.recentTrades = [];
    this.initialSinkBalance = 0;
    this.checkCounter = 0;
  }

  /**
   * Records a trade result
   * @param {boolean} success
   */
  recordTradeResult(success) {
    if (!this.config.enableCircuitBreaker) return;

    this.recentTrades.push(success);
    if (this.recentTrades.length > this.config.failureRateWindow) {
      this.recentTrades.shift();
    }

    if (success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
    }
  }

  /**
   * Checks if circuit breaker should trip
   * @param {Connection} connection
   * @param {Keypair|null} sinkKeypair
   * @returns {Promise<Object>}
   */
  async checkCircuitBreakers(connection, sinkKeypair) {
    if (!this.config.enableCircuitBreaker) return { tripped: false, reason: '' };

    // Check consecutive failures
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      return {
        tripped: true,
        reason: `Circuit Breaker: ${this.consecutiveFailures} consecutive failures`,
      };
    }

    // Check failure rate
    if (this.recentTrades.length >= this.config.failureRateWindow) {
      const failures = this.recentTrades.filter(r => !r).length;
      const failureRate = (failures / this.recentTrades.length) * 100;

      if (failureRate > this.config.maxFailureRate) {
        return {
          tripped: true,
          reason: `Circuit Breaker: ${failureRate.toFixed(1)}% failure rate (last ${this.config.failureRateWindow} trades)`,
        };
      }
    }

    // Check emergency stop loss
    this.checkCounter++;
    if (sinkKeypair && this.initialSinkBalance > 0n && this.checkCounter % 5 === 0) {
      const currentBalance = BigInt(await connection.getBalance(sinkKeypair.publicKey));
      const loss = Number((this.initialSinkBalance - currentBalance) * 100n / this.initialSinkBalance);

      if (loss > this.config.emergencyStopLoss) {
        return {
          tripped: true,
          reason: `Circuit Breaker: ${loss.toFixed(1)}% loss from initial balance`,
        };
      }
    }

    return { tripped: false, reason: '' };
  }
}