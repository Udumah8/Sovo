import { config } from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { SUPPORTED_MARKETS, BEHAVIOR_PROFILES, TRADE_MODES } from '../constants.js';

// Load environment variables from .env file
config();

/**
 * Configuration Validator and Manager
 * Ensures all environment variables are validated and sanitized
 */
export class ConfigManager {
  constructor() {
    this.validateAndLoadConfig();
  }

  /**
   * Validates and loads all configuration from environment variables
   * @throws {Error} If any required config is invalid
   */
  validateAndLoadConfig() {
    // Required configs
    this.rpcUrl = this.validateRpcUrl('RPC_URL', process.env.RPC_URL);
    this.memeCoinMint = this.validatePublicKey('MEME_COIN_MINT', process.env.MEME_COIN_MINT);
    this.memeCoinSymbol = this.validateString('MEME_COIN_SYMBOL', process.env.MEME_COIN_SYMBOL || 'solana');
    this.market = this.validateMarket('MARKET', process.env.MARKET);

    // Wallet configs
    this.maxWallets = this.validateMaxWallets('MAX_WALLETS', process.env.MAX_WALLETS);
    this.numWalletsToGenerate = this.validateNumber('NUM_WALLETS_TO_GENERATE', process.env.NUM_WALLETS_TO_GENERATE, 1, 10000, 10);
    this.fundAmount = this.validateSolAmount('FUND_AMOUNT', process.env.FUND_AMOUNT, 0.001, 10, 0.05);

    // Trading configs
    this.tradeMode = this.validateTradeMode('TRADE_MODE', process.env.TRADE_MODE || 'adaptive');
    this.buyProb = this.validateProbability('BUY_PROB', process.env.BUY_PROB, 0.5);
    this.numActionsPerCycle = this.validateNumber('NUM_ACTIONS_PER_CYCLE', process.env.NUM_ACTIONS_PER_CYCLE, 1, 10, 2);
    this.swapAmount = this.validateSolAmount('SWAP_AMOUNT', process.env.SWAP_AMOUNT, 0.0001, 1, 0.01);

    // Timing configs
    this.baseDelayMs = this.validateNumber('DELAY_MS', process.env.DELAY_MS, 100, 60000, 5000);
    this.jitterPct = this.validatePercentage('JITTER_PCT', process.env.JITTER_PCT, 10);

    // Stealth configs
    this.sinkPrivateKey = this.validateOptionalJsonArray('SINK_PRIVATE_KEY', process.env.SINK_PRIVATE_KEY);
    this.relayerPrivateKeys = this.validateOptionalJsonArray('RELAYER_PRIVATE_KEYS', process.env.RELAYER_PRIVATE_KEYS);
    this.enableRebalancing = this.validateBoolean('ENABLE_REBALANCING', process.env.ENABLE_REBALANCING, true);

    // Market data configs
    this.birdeyeApiKey = this.validateOptionalString('BIRDEYE_API_KEY', process.env.BIRDEYE_API_KEY);
    this.memeCoinPairAddress = this.validateOptionalString('MEME_COIN_PAIR_ADDRESS', process.env.MEME_COIN_PAIR_ADDRESS);
    this.minLiquidity = this.validateNumber('MIN_LIQUIDITY_USD', process.env.MIN_LIQUIDITY_USD, 1000, 10000000, 5000);
    this.maxPriceImpact = this.validatePercentage('MAX_PRICE_IMPACT_PCT', process.env.MAX_PRICE_IMPACT_PCT, 5);

    // Circuit breaker configs
    this.enableCircuitBreaker = this.validateBoolean('ENABLE_CIRCUIT_BREAKER', process.env.ENABLE_CIRCUIT_BREAKER, true);
    this.maxConsecutiveFailures = this.validateNumber('MAX_CONSECUTIVE_FAILURES', process.env.MAX_CONSECUTIVE_FAILURES, 1, 100, 10);
    this.maxFailureRate = this.validatePercentage('MAX_FAILURE_RATE_PCT', process.env.MAX_FAILURE_RATE_PCT, 50);
    this.failureRateWindow = this.validateNumber('FAILURE_RATE_WINDOW', process.env.FAILURE_RATE_WINDOW, 5, 100, 10);
    this.emergencyStopLoss = this.validatePercentage('EMERGENCY_STOP_LOSS_PCT', process.env.EMERGENCY_STOP_LOSS_PCT, 30);

    // Other configs
    this.concurrency = this.validateNumber('CONCURRENCY', process.env.CONCURRENCY, 1, 1000, 50);
    this.batchSize = this.validateNumber('BATCH_SIZE', process.env.BATCH_SIZE, 1, 1000, 100);
    this.retryAttempts = this.validateNumber('RETRY_ATTEMPTS', process.env.RETRY_ATTEMPTS, 1, 10, 3);

    // Wallet seasoning
    this.enableSeasoning = this.validateBoolean('ENABLE_SEASONING', process.env.ENABLE_SEASONING, false);
    this.seasoningMinTxs = this.validateNumber('SEASONING_MIN_TXS', process.env.SEASONING_MIN_TXS, 1, 20, 3);
    this.seasoningMaxTxs = this.validateNumber('SEASONING_MAX_TXS', process.env.SEASONING_MAX_TXS, 1, 50, 10);
    this.seasoningDelayMs = this.validateNumber('SEASONING_DELAY_MS', process.env.SEASONING_DELAY_MS, 1000, 30000, 5000);

    // Jito MEV
    this.enableJito = this.validateBoolean('ENABLE_JITO', process.env.ENABLE_JITO, true);
    this.jitoFee = this.validateSolAmount('JITO_PRIORITY_FEE_SOL', process.env.JITO_PRIORITY_FEE_SOL, 0.0001, 0.01, 0.002);
    this.jitoTipBuy = this.validateSolAmount('JITO_TIP_SOL_BUY', process.env.JITO_TIP_SOL_BUY, 0.0001, 0.01, 0.0012);
    this.jitoTipSell = this.validateSolAmount('JITO_TIP_SOL_SELL', process.env.JITO_TIP_SOL_SELL, 0.0001, 0.01, 0.0018);

    // Auto-scaling
    this.autoScale = this.validateBoolean('AUTO_SCALE_CONCURRENCY', process.env.AUTO_SCALE_CONCURRENCY, true);

    // Partial sell
    this.partialSellEnabled = this.validateBoolean('PARTIAL_SELL_ENABLED', process.env.PARTIAL_SELL_ENABLED, true);
    this.partialSellMin = this.validatePercentage('PARTIAL_SELL_MIN_PCT', process.env.PARTIAL_SELL_MIN_PCT, 22);
    this.partialSellMax = this.validatePercentage('PARTIAL_SELL_MAX_PCT', process.env.PARTIAL_SELL_MAX_PCT, 68);

    // Behavior
    this.behaviorProfile = this.validateBehaviorProfile('BEHAVIOR_PROFILE', process.env.BEHAVIOR_PROFILE || 'retail');

    // Wallet rotation
    this.minWalletCooldownMs = this.validateNumber('MIN_WALLET_COOLDOWN_MS', process.env.MIN_WALLET_COOLDOWN_MS, 60000, 3600000, 300000);
    this.maxWalletCooldownMs = this.validateNumber('MAX_WALLET_COOLDOWN_MS', process.env.MAX_WALLET_COOLDOWN_MS, 60000, 3600000, 1800000);
    this.shuffleWallets = this.validateBoolean('SHUFFLE_WALLETS', process.env.SHUFFLE_WALLETS, true);

    // Rebalancing
    this.minWalletBalance = this.validateSolAmount('MIN_WALLET_BALANCE_SOL', process.env.MIN_WALLET_BALANCE_SOL, 0.001, 1, 0.005);
    this.targetWalletBalance = this.validateSolAmount('TARGET_WALLET_BALANCE_SOL', process.env.TARGET_WALLET_BALANCE_SOL, 0.001, 1, 0.05);
    this.rebalanceInterval = this.validateNumber('REBALANCE_INTERVAL_CYCLES', process.env.REBALANCE_INTERVAL_CYCLES, 1, 1000, 50);
    this.dustThreshold = this.validateSolAmount('DUST_THRESHOLD_SOL', process.env.DUST_THRESHOLD_SOL, 0.0001, 0.01, 0.001);

    // Session
    this.sessionPauseMin = this.validateNumber('SESSION_PAUSE_MIN', process.env.SESSION_PAUSE_MIN, 1, 100, 10);

    // TWAP
    this.twapParts = this.validateNumber('TWAP_PARTS', process.env.TWAP_PARTS, 1, 20, 5);
    this.twapMaxDelay = this.validateNumber('TWAP_MAX_DELAY', process.env.TWAP_MAX_DELAY, 1000, 60000, 10000);

    // Vol threshold
    this.volThreshold = this.validatePercentage('VOL_THRESHOLD', process.env.VOL_THRESHOLD, 0.05);

    // Ramp cycles
    this.rampCycles = this.validateNumber('RAMP_CYCLES', process.env.RAMP_CYCLES, 1, 1000, 30);

    // Keyboard triggers
    this.enableKeyboard = this.validateBoolean('ENABLE_KEYBOARD_TRIGGERS', process.env.ENABLE_KEYBOARD_TRIGGERS, false);

    // Wallet file
    this.walletFile = this.validateString('WALLET_FILE', process.env.WALLET_FILE || DEFAULT_WALLET_FILE);

    // Derived configs
    this.isDevnet = this.rpcUrl.includes('devnet');
    this.useBirdeye = !!this.birdeyeApiKey;
  }

  validateRpcUrl(key, value) {
    const url = this.validateString(key, value);
    try {
      new URL(url);
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        throw new Error('Invalid protocol');
      }
      return url;
    } catch {
      throw new Error(`Invalid ${key}: must be a valid HTTP/HTTPS URL`);
    }
  }

  validateString(key, value) {
    if (!value || typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Invalid ${key}: must be a non-empty string`);
    }
    return value.trim();
  }

  validateOptionalString(key, value) {
    return value && typeof value === 'string' ? value.trim() : null;
  }

  validateNumber(key, value, min, max, defaultValue) {
    const num = value ? parseFloat(value) : defaultValue;
    if (isNaN(num) || num < min || num > max) {
      throw new Error(`Invalid ${key}: must be a number between ${min} and ${max}`);
    }
    return num;
  }

  validateSolAmount(key, value, min, max, defaultValue) {
    const amount = this.validateNumber(key, value, min, max, defaultValue);
    return Math.floor(amount * 1e9); // Convert to lamports
  }

  validatePercentage(key, value, defaultValue) {
    const pct = this.validateNumber(key, value, 0, 100, defaultValue);
    return pct / 100;
  }

  validateProbability(key, value, defaultValue) {
    return this.validateNumber(key, value, 0, 1, defaultValue);
  }

  validateBoolean(key, value, defaultValue) {
    if (value === undefined || value === null) return defaultValue;
    const str = value.toString().toLowerCase();
    if (str === 'true' || str === '1' || str === 'yes') return true;
    if (str === 'false' || str === '0' || str === 'no') return false;
    throw new Error(`Invalid ${key}: must be a boolean (true/false)`);
  }

  validatePublicKey(key, value) {
    try {
      return new PublicKey(value);
    } catch (error) {
      throw new Error(`Invalid ${key}: must be a valid Solana public key`);
    }
  }

  validateOptionalJsonArray(key, value) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        throw new Error('Must be an array');
      }
      // Validate each element is a valid private key array
      for (const item of parsed) {
        if (!Array.isArray(item) || item.length !== 64 || !item.every(n => typeof n === 'number' && n >= 0 && n <= 255)) {
          throw new Error('Invalid private key format');
        }
      }
      return parsed;
    } catch (error) {
      throw new Error(`Invalid ${key}: must be a valid JSON array of private keys`);
    }
  }

  validateMarket(key, value) {
    const market = this.validateString(key, value);
    if (!SUPPORTED_MARKETS.includes(market)) {
      throw new Error(`Invalid ${key}: must be one of ${SUPPORTED_MARKETS.join(', ')}`);
    }
    return market;
  }

  validateTradeMode(key, value) {
    const mode = this.validateString(key, value);
    if (!TRADE_MODES.includes(mode)) {
      throw new Error(`Invalid ${key}: must be one of ${TRADE_MODES.join(', ')}`);
    }
    return mode;
  }

  validateBehaviorProfile(key, value) {
    const profile = this.validateString(key, value);
    if (!BEHAVIOR_PROFILES.includes(profile)) {
      throw new Error(`Invalid ${key}: must be one of ${BEHAVIOR_PROFILES.join(', ')}`);
    }
    return profile;
  }

  validateMaxWallets(key, value) {
    if (!value || value.toLowerCase() === 'all') {
      return Infinity;
    }
    return this.validateNumber(key, value, 100, 100000, 1000);
  }
}