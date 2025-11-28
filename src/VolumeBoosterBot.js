import { Connection, Keypair, Transaction, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { ConfigManager } from './config/ConfigManager.js';
import { Logger } from './logging/Logger.js';
import { WalletManager } from './wallet/WalletManager.js';
import { MarketDataProvider } from './market/MarketDataProvider.js';
import { TradingEngine } from './trading/TradingEngine.js';
import { CircuitBreaker } from './safety/CircuitBreaker.js';
import { WalletRebalancer } from './rebalancing/WalletRebalancer.js';
import { WalletSeasoner } from './seasoning/WalletSeasoner.js';
import { setTimeout as delay } from 'timers/promises';
import jsonfile from 'jsonfile';
import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { getJitteredValue } from './utils.js';
import { createCloseAccountInstruction, getAssociatedTokenAddressSync, getAccount, AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  USDC_MINT,
  LAMPORTS_PER_SOL_BN,
  MIN_SOL_BUFFER_LAMPORTS,
  PRIORITY_FEE_MICRO_LAMPORTS,
  MIN_TRANSFER_LAMPORTS
} from './constants.js';

/**
 * Main Volume Booster Bot - Orchestrator
 */
export class VolumeBoosterBot {
  /**
   * Constructor - Initializes all systems
   */
  constructor() {
    this.config = new ConfigManager();
    this.logger = new Logger();
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');
    this.walletManager = new WalletManager(this.config, this.connection, this.logger);
    this.marketData = new MarketDataProvider(this.config, this.connection, this.logger);
    this.tradingEngine = new TradingEngine(this.config, this.connection, this.marketData, this.walletManager, this.logger);
    this.circuitBreaker = new CircuitBreaker(this.config, this.logger);
    this.rebalancer = new WalletRebalancer(this.config, this.walletManager, this.connection, this.logger);
    this.seasoner = new WalletSeasoner(this.config, this.walletManager, this.connection, this.logger);

    this.isRunning = false;
    this.cycleCount = 0;
    this.totalVolume = 0;
  }

  /**
   * Initializes the bot
   */
  async init() {
    try {
      this.logger.info('Initializing Volume Booster Bot');

      await this.walletManager.loadOrGenerateWallets();
      this.walletManager.assignPersonalities();

      await this.seasoner.seasonWallets();

      this.logger.info('Fetching initial market data');
      await this.marketData.getMarketData();

      this.isRunning = true;
      this.logger.info('Bot starting', {
        wallets: this.walletManager.allPubkeys.size,
        activeBatch: this.walletManager.activeWallets.length,
        concurrency: this.config.concurrency,
        batchSize: this.config.batchSize,
        network: this.config.isDevnet ? 'Devnet' : 'Mainnet',
        market: this.config.market,
        tradeMode: this.config.tradeMode,
        buyProb: this.config.buyProb,
        actionsPerCycle: this.config.numActionsPerCycle,
        cooldown: `${(this.config.minWalletCooldownMs / 60000).toFixed(1)}-${(this.config.maxWalletCooldownMs / 60000).toFixed(1)} min`,
        shuffle: this.config.shuffleWallets,
        birdeye: this.config.useBirdeye,
        rebalancing: this.config.enableRebalancing,
        circuitBreaker: this.config.enableCircuitBreaker
      });

      if (this.config.useBirdeye) {
        this.logger.info('Market settings', {
          minLiquidity: this.config.minLiquidity.toLocaleString(),
          maxPriceImpact: this.config.maxPriceImpact
        });
      }

      if (this.config.enableRebalancing) {
        this.logger.info('Rebalancing settings', {
          targetBalance: (Number(this.config.targetWalletBalance) / Number(LAMPORTS_PER_SOL)).toFixed(3),
          interval: `Every ${this.config.rebalanceInterval} cycles`
        });
      }

      if (this.config.enableCircuitBreaker) {
        this.logger.info('Circuit breaker settings', {
          maxFailures: this.config.maxConsecutiveFailures,
          maxFailureRate: this.config.maxFailureRate,
          stopLoss: this.config.emergencyStopLoss
        });
      }

      if (this.walletManager.sinkKeypair) {
        this.circuitBreaker.initialSinkBalance = BigInt(await this.connection.getBalance(this.walletManager.sinkKeypair.publicKey));
        this.logger.info('Initial sink balance locked', {
          balance: (Number(this.circuitBreaker.initialSinkBalance) / Number(LAMPORTS_PER_SOL)).toFixed(4)
        });
      }

      await this.runLoop();
    } catch (error) {
      this.logger.error('Bot initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Main trading loop
   */
  async runLoop() {
    let batchNum = 0;

    while (this.isRunning) {
      const circuitCheck = await this.circuitBreaker.checkCircuitBreakers(this.connection, this.walletManager.sinkKeypair);
      if (circuitCheck.tripped) {
        this.logger.error('Circuit breaker tripped', { reason: circuitCheck.reason });
        this.logger.error('Bot stopped for safety');
        await this.stop();
        process.exit(1);
      }

      await this.walletManager.loadActiveBatch();
      const walletBatch = this.walletManager.activeWallets;

      if (walletBatch.length === 0) {
        this.logger.info('No wallets available, waiting for cooldowns');
        await delay(30000);
        continue;
      }

      batchNum++;
      this.cycleCount++;

      // Fetch and log current market price
      const marketData = await this.marketData.getMarketData();
      this.logger.info(`Current market price: $${marketData.price.toFixed(6)} (Source: ${marketData.source})`);

      this.logger.info(`Starting batch ${batchNum}`, {
        cycle: this.cycleCount,
        ramp: Math.min(1, (this.cycleCount / this.config.rampCycles) * 100).toFixed(0)
      });

      const promises = walletBatch.map(wallet => this.tradingEngine.processWalletCycle(wallet, this.circuitBreaker));
      const results = await Promise.allSettled(promises);
      const successes = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      this.logger.info(`Batch ${batchNum} complete`, {
        successful: successes,
        total: walletBatch.length
      });

      if (batchNum % 10 === 0) {
        this.printRotationStats();
      }

      if (this.config.enableRebalancing && this.cycleCount % this.config.rebalanceInterval === 0) {
        await this.rebalancer.rebalanceWallets();
      }

      if (batchNum % this.config.sessionPauseMin === 0) {
        const pauseMs = getJitteredValue(60000 * (1 + Math.random() * 4), this.config.jitterPct);
        this.logger.info('Session pause', { duration: (pauseMs / 1000).toFixed(0) });
        await delay(pauseMs);
      }

      const interBatchDelay = Math.random() * 10000 + 5000;
      await delay(interBatchDelay);
    }
  }

  /**
   * Prints wallet rotation statistics
   */
  printRotationStats() {
    this.logger.info('Wallet Rotation Stats', {
      activeBatch: this.walletManager.activeWallets.length,
      onCooldown: this.walletManager.walletCooldowns.size
    });

    const sortedWallets = Array.from(this.walletManager.walletTradeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (sortedWallets.length > 0) {
      this.logger.info('Top Active Wallets');
      sortedWallets.forEach(([key, count], i) => {
        this.logger.info(`  ${i + 1}. ${key.slice(0, 8)}...: ${count} trades`);
      });
    }
  }

  /**
   * Stops the bot and performs cleanup
   */
  async stop() {
    this.isRunning = false;
    this.logger.info('Bot stopping');

    await this.closeAllTokenAccounts();
    if (this.walletManager.sinkKeypair) {
      await this.withdrawAllFunds();
    }

    this.logger.info('Bot stopped', {
      totalVolume: this.totalVolume.toFixed(2)
    });
  }

  /**
   * Withdraws all funds to sink wallet
   */
  async withdrawAllFunds() {
    if (!this.walletManager.sinkKeypair) {
      this.logger.info('No sink wallet configured');
      return;
    }

    this.logger.info('Starting parallel withdrawal');

    // Cache wallet data to avoid multiple reads
    if (!this.cachedWalletData) {
      this.cachedWalletData = await jsonfile.readFile(this.config.walletFile);
    }
    const allWalletsData = this.cachedWalletData;
    const chunkSize = 50;
    let successCount = 0;

    for (let i = 0; i < allWalletsData.length; i += chunkSize) {
      const chunk = allWalletsData.slice(i, i + chunkSize).map(w => ({
        keypair: Keypair.fromSecretKey(new Uint8Array(w.privateKey)),
        name: w.name || w.pubkey.slice(0, 6)
      }));

      // Batch balance checks to reduce RPC calls
      const balancePromises = chunk.map(wallet => this.connection.getBalance(wallet.keypair.publicKey));
      const balances = await Promise.allSettled(balancePromises);

      const withdrawalPromises = chunk.map((wallet, index) => {
        if (balances[index].status === 'fulfilled') {
          // Pass balance to avoid re-fetching
          return this.withdrawSingleWallet(wallet, balances[index].value);
        } else {
          return this.withdrawSingleWallet(wallet);
        }
      });

      const results = await Promise.allSettled(withdrawalPromises);
      successCount += results.filter(r => r.status === 'fulfilled' && r.value).length;
      this.logger.info('Withdrawal progress', {
        processed: Math.min(i + chunkSize, allWalletsData.length),
        total: allWalletsData.length
      });
    }

    const sinkBalance = BigInt(await this.connection.getBalance(this.walletManager.sinkKeypair.publicKey));
    this.logger.info('Withdrawal complete', {
      successful: successCount,
      total: allWalletsData.length,
      finalSinkBalance: (Number(sinkBalance) / Number(LAMPORTS_PER_SOL)).toFixed(4)
    });

    // Sink token cleanup
    await this.cleanupSinkTokenAccounts();
  }

  /**
   * Cleans up empty token accounts for the sink wallet
   */
  async cleanupSinkTokenAccounts() {
    if (!this.walletManager.sinkKeypair) return;

    const tokensToCheck = [this.config.memeCoinMint, USDC_MINT];
    for (const mint of tokensToCheck) {
      const sinkTokenAcc = getAssociatedTokenAddressSync(mint, this.walletManager.sinkKeypair.publicKey);
      try {
        const accountInfo = await getAccount(this.connection, sinkTokenAcc);
        const balance = accountInfo.amount;
        if (balance === 0n) {
          const closeTx = new Transaction().add(createCloseAccountInstruction(
            sinkTokenAcc,
            this.walletManager.sinkKeypair.publicKey,
            this.walletManager.sinkKeypair.publicKey
          ));
          await this.connection.sendTransaction(closeTx, [this.walletManager.sinkKeypair]);
          this.logger.info('Sink token account closed', { mint: mint.toBase58().slice(0, 8) });
        }
      } catch (error) {
        // Ignore if account doesn't exist
      }
    }
  }

  /**
   * Withdraws funds from a single wallet
   * @param {Object} wallet
   * @param {number} [cachedBalance] - Optional cached balance to avoid re-fetching
   */
  async withdrawSingleWallet(wallet, cachedBalance) {
    try {
      const balance = cachedBalance !== undefined ? cachedBalance : await this.connection.getBalance(wallet.keypair.publicKey);
      const priorityFee = BigInt(PRIORITY_FEE_MICRO_LAMPORTS);
      let transferAmount = balance - MIN_SOL_BUFFER_LAMPORTS - priorityFee;

      // Add small jitter to avoid patterns
      const jitterAmount = BigInt(Math.floor(getJitteredValue(1000, 0.5))); // Small random amount
      transferAmount = transferAmount - jitterAmount;

      if (transferAmount < MIN_TRANSFER_LAMPORTS) return false;

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }),
        SystemProgram.transfer({
          fromPubkey: wallet.keypair.publicKey,
          toPubkey: this.walletManager.sinkKeypair.publicKey,
          lamports: transferAmount,
        })
      );

      const signature = await this.connection.sendTransaction(tx, [wallet.keypair]);
      this.logger.info('Swept SOL from wallet', {
        wallet: wallet.keypair.publicKey.toBase58(),
        amount: (Number(transferAmount) / Number(LAMPORTS_PER_SOL_BN)).toFixed(6),
        tx: signature
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to sweep SOL', {
        wallet: wallet.keypair.publicKey.toBase58(),
        error: error.message
      });
      return false;
    }
  }

  /**
   * Closes all empty token accounts for rent recovery
   */
  async closeAllTokenAccounts() {
    this.logger.info('Closing empty token accounts');

    // Use cached wallet data if available
    if (!this.cachedWalletData) {
      this.cachedWalletData = await jsonfile.readFile(this.config.walletFile);
    }
    const allWalletsData = this.cachedWalletData;
    const chunkSize = 50;

    for (let i = 0; i < allWalletsData.length; i += chunkSize) {
      const chunk = allWalletsData.slice(i, i + chunkSize).map(w => ({
        keypair: Keypair.fromSecretKey(new Uint8Array(w.privateKey)),
        name: w.name || w.pubkey.slice(0, 6)
      }));

      const promises = chunk.map(wallet => this.closeWalletTokenAccounts(wallet));
      await Promise.allSettled(promises);
      this.logger.info('Token account closure progress', {
        processed: Math.min(i + chunkSize, allWalletsData.length),
        total: allWalletsData.length
      });
    }
  }

  /**
   * Closes token accounts for a single wallet
   * @param {Object} wallet
   */
  async closeWalletTokenAccounts(wallet) {
    const mintsToClose = [this.config.memeCoinMint, USDC_MINT];
    const ataAddresses = mintsToClose.map(mint => getAssociatedTokenAddressSync(mint, wallet.keypair.publicKey));

    const accountInfos = await this.connection.getMultipleAccounts(ataAddresses, { commitment: 'confirmed' });

    for (let i = 0; i < mintsToClose.length; i++) {
      const mint = mintsToClose[i];
      const ataAddress = ataAddresses[i];
      const accountInfo = accountInfos[i];

      if (!accountInfo) {
        // Account not found
        continue;
      }

      const data = AccountLayout.decode(accountInfo.account.data);
      const amount = data.amount;

      if (amount !== 0n) {
        this.logger.warn('Skipping ATA close: non-zero balance', {
          wallet: wallet.name,
          mint: mint.toBase58().slice(0, 8),
          balance: amount.toString()
        });
        continue;
      }

      const closeIx = createCloseAccountInstruction(
        ataAddress,
        wallet.keypair.publicKey,
        wallet.keypair.publicKey,
        [wallet.keypair],
        TOKEN_PROGRAM_ID
      );

      const tx = new Transaction().add(closeIx);

      try {
        const signature = await this.connection.sendTransaction(tx, [wallet.keypair]);

        this.logger.info('Closed ATA', {
          wallet: wallet.name,
          mint: mint.toBase58().slice(0, 8),
          tx: signature
        });
      } catch (error) {
        this.logger.error('Failed to close ATA', {
          wallet: wallet.name,
          mint: mint.toBase58().slice(0, 8),
          error: error.message
        });
      }
    }
  }
}