import { Keypair, Transaction } from '@solana/web3.js';
import jsonfile from 'jsonfile';
import { setTimeout as delay } from 'timers/promises';
import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import fs from 'fs/promises';
import BN from 'bn.js';
import {
  MIN_SOL_BUFFER_LAMPORTS,
  MIN_SOL_BUFFER_LAMPORTS_BN,
  PRIORITY_FEE_MICRO_LAMPORTS,
  MAX_COOLDOWN_AGE_MS,
  PERSONALITIES
} from '../constants.js';

/**
 * Wallet Management System
 * Handles wallet generation, loading, funding, and rotation
 */
export class WalletManager {
  /**
   * @param {ConfigManager} config
   * @param {Connection} connection
   * @param {Logger} logger
   */
  constructor(config, connection, logger) {
    this.config = config;
    this.connection = connection;
    this.logger = logger;
    this.walletData = [];
    this.allPubkeys = new Set();
    this.funded = new Set();
    this.activeWallets = [];
    this.walletCooldowns = new Map();
    this.walletTradeCount = new Map();
    this.walletPersonalities = new Map();
    this.sinkKeypair = config.sinkPrivateKey ? Keypair.fromSecretKey(new Uint8Array(config.sinkPrivateKey)) : null;
    this.relayerKeypairs = config.relayerPrivateKeys ? config.relayerPrivateKeys.map(pk => Keypair.fromSecretKey(new Uint8Array(pk))) : [];
  }

  /**
   * Loads or generates wallets based on configuration
   */
  async loadOrGenerateWallets() {
  try {
    try {
      this.walletData = await jsonfile.readFile(this.config.walletFile);
      this.normalizeWalletData();
      this.allPubkeys = new Set(this.walletData.map(w => w.pubkey));
      this.logger.info(`Loaded ${this.walletData.length.toLocaleString()} existing wallets`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      this.logger.info('No existing wallet file found, will generate new wallets.');
    }

      if (this.walletData.length < this.config.numWalletsToGenerate) {
        await this.generateWallets();
      }

      if (this.config.autoScale) {
        this.config.concurrency = Math.min(50, Math.max(3, Math.floor(this.walletData.length / 200) + 3));
        this.config.batchSize = Math.min(20, Math.max(2, Math.floor(this.walletData.length / 300) + 2));
      }

      await this.fundWalletsInParallel();
    } catch (error) {
      this.logger.error('Failed to load or generate wallets', { error: error.message });
      throw error;
    }
  }

  /**
   * Normalizes wallet data structure
   */
  normalizeWalletData() {
    this.walletData = this.walletData.map(w => ({
      pubkey: w.pubkey || w.publicKey || Keypair.fromSecretKey(new Uint8Array(w.privateKey)).publicKey.toBase58(),
      privateKey: w.privateKey,
      name: w.name || `Wallet`,
      isSeasoned: w.isSeasoned || false
    }));
  }

  /**
   * Generates additional wallets to meet the required count
   */
  async generateWallets() {
    const remaining = this.config.numWalletsToGenerate - this.walletData.length;
    this.logger.info(`Generating ${remaining.toLocaleString()} wallets...`);

    const batchSize = 1000;
    for (let i = 0; i < remaining; i += batchSize) {
      const size = Math.min(batchSize, remaining - i);
      const batch = [];
      for (let j = 0; j < size; j++) {
        const kp = Keypair.generate();
        const wallet = {
          pubkey: kp.publicKey.toBase58(),
          privateKey: Array.from(kp.secretKey),
          name: `Wallet${this.walletData.length + i + j + 1}`,
          isSeasoned: false
        };
        batch.push(wallet);
        this.allPubkeys.add(wallet.pubkey);
      }
      this.walletData.push(...batch);
      this.logger.info(`${this.walletData.length.toLocaleString()}/${this.config.numWalletsToGenerate.toLocaleString()}`);
      await delay(10);
    }

    await jsonfile.writeFile(this.config.walletFile, this.walletData, { spaces: 2 });
  }

  /**
   * Funds wallets in parallel using relayer wallets
   */
  async fundWalletsInParallel() {
    if (this.relayerKeypairs.length === 0) {
      this.logger.info('No relayer wallets configured, skipping funding');
      return;
    }

    this.logger.info(`Checking funding for ${this.walletData.length} wallets...`);
    const toCheck = this.walletData.filter(w => !this.funded.has(w.pubkey));

    const fundBatchSize = 50;
    for (let i = 0; i < toCheck.length; i += fundBatchSize) {
      const batch = toCheck.slice(i, i + fundBatchSize);
      const promises = batch.map(wallet => this.fundSingleWallet(wallet));
      await Promise.allSettled(promises);
      this.logger.info(`Funding progress: ${Math.min(i + fundBatchSize, toCheck.length)}/${toCheck.length}`);
    }
  }

  /**
   * Funds a single wallet
   * @param {Object} wallet
   */
  async fundSingleWallet(wallet) {
    if (this.funded.has(wallet.pubkey)) return;

    const kp = Keypair.fromSecretKey(new Uint8Array(wallet.privateKey));
    try {
        const balance = BigInt(await this.connection.getBalance(kp.publicKey));
        const balanceBN = new BN(balance.toString());
        const threshold = new BN(this.config.fundAmount.toString()).mul(new BN('8')).div(new BN('10'));
        if (balanceBN.gte(threshold)) {
            this.funded.add(wallet.pubkey);
            return;
        }

        const remaining = new BN(this.config.fundAmount.toString()).sub(balanceBN);
        const parts = Math.floor(Math.random() * 4) + 1;

        for (let p = 0;
             p < parts && remaining.gt(MIN_SOL_BUFFER_LAMPORTS_BN);
             p++)
        {
            const remainingParts = parts - p;
            const factor = Math.floor((0.6 + Math.random() * 0.8) * 1000);
            const basePart = remaining.mul(new BN(factor)).div(new BN(1000)).div(new BN(remainingParts.toString()));

            const minBufferBN = MIN_SOL_BUFFER_LAMPORTS_BN;

            const partNum = BN.max(basePart, minBufferBN);
            const cappedPart = BN.min(partNum, remaining);

            const relayer = this.relayerKeypairs[Math.floor(Math.random() * this.relayerKeypairs.length)];

            const tx = new Transaction()
                .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 25000 }))
                .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }))
                .add(SystemProgram.transfer({
                    fromPubkey: relayer.publicKey,
                    toPubkey: kp.publicKey,
                    lamports: BigInt(cappedPart.toString()),
                }));

            const sig = await this.connection.sendTransaction(tx, [relayer], {
                skipPreflight: true
            });
            await this.connection.confirmTransaction(sig, 'confirmed');

            this.logger.info(`Funded ${wallet.name}: ${(cappedPart.div(new BN('1000000000')).toNumber()).toFixed(4)} SOL`);
            remaining.isub(cappedPart);
            remaining = BN.max(remaining, new BN('0'));
            await delay(1000 + Math.random() * 2000);
        }
        this.funded.add(wallet.pubkey);
    } catch (error) {
        this.logger.warn(`Failed to fund ${wallet.name}`, { error: error.message });
    }
  }

  /**
    * Loads the next batch of active wallets for trading
    */
  async loadActiveBatch() {
    const now = Date.now();
    // Clean up old cooldowns to prevent memory leaks
    this.cleanupOldCooldowns(now);

    const ready = this.walletData.filter(w => {
      const lastTrade = this.walletCooldowns.get(w.pubkey) || 0;
      const cooldown = this.getWalletCooldown(w.pubkey);
      return now - lastTrade >= cooldown;
    });

    if (ready.length === 0) return [];

    const shuffled = this.config.shuffleWallets ? this.shuffleArray(ready) : ready;
    const selected = shuffled.slice(0, this.config.batchSize);

    this.activeWallets = selected.map(w => ({
      keypair: Keypair.fromSecretKey(new Uint8Array(w.privateKey)),
      name: w.name || w.pubkey.slice(0, 6),
      pubkey: w.pubkey
    }));

    this.logger.info(`Loaded batch: ${this.activeWallets.length} wallets (Pool: ${ready.length}/${this.walletData.length})`);
    return this.activeWallets;
  }

  /**
   * Cleans up old cooldown entries to prevent memory leaks
   * @param {number} now
   */
  cleanupOldCooldowns(now) {
    for (const [key, timestamp] of this.walletCooldowns.entries()) {
      if (now - timestamp > MAX_COOLDOWN_AGE_MS) {
        this.walletCooldowns.delete(key);
      }
    }
    // Also clean trade counts occasionally
    if (Math.random() < 0.01) { // 1% chance
      for (const [key, count] of this.walletTradeCount.entries()) {
        if (count > 1000) { // Reset very high counts
          this.walletTradeCount.set(key, 1000);
        }
      }
    }
  }

  /**
   * Shuffles an array using Fisher-Yates algorithm
   * @param {Array} array
   * @returns {Array}
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Gets the cooldown period for a wallet
   * @param {string} walletKey
   * @returns {number}
   */
  getWalletCooldown(walletKey) {
    const tradeCount = this.walletTradeCount.get(walletKey) || 0;
    const cooldownMultiplier = 1 + (tradeCount % 5) * 0.2;
    const baseCooldown = this.config.minWalletCooldownMs + Math.random() * (this.config.maxWalletCooldownMs - this.config.minWalletCooldownMs);
    return Math.floor(baseCooldown * cooldownMultiplier);
  }

  /**
   * Marks a wallet as used after trading
   * @param {Object} wallet
   */
  markWalletUsed(wallet) {
    const walletKey = wallet.keypair.publicKey.toBase58();
    this.walletCooldowns.set(walletKey, Date.now());
    this.walletTradeCount.set(walletKey, (this.walletTradeCount.get(walletKey) || 0) + 1);
  }

  /**
   * Assigns personalities to wallets for varied behavior
   */
  assignPersonalities() {
    this.allPubkeys.forEach(pubkey => {
      this.walletPersonalities.set(pubkey, PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)]);
    });
  }

  /**
   * Gets the personality of a wallet
   * @param {string|PublicKey} pubkey
   * @returns {string}
   */
  getPersonality(pubkey) {
    const key = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
    return this.walletPersonalities.get(key) || 'flipper';
  }

}