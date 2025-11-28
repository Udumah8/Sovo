import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { SolanaTrade } from 'solana-trade';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import axios from 'axios';
import pLimit from 'p-limit';
import { setTimeout as delay } from 'timers/promises';
import BN from 'bn.js';
import {
  DEFAULT_SLIPPAGE_RETAIL,
  DEFAULT_SLIPPAGE_WHALE,
  MIN_MEME_TOKENS,
  SENTIMENT_FETCH_COOLDOWN_MS
} from '../constants.js';
import { getJitteredValue } from '../utils.js';

/**
 * Trading Engine with Advanced Strategies
 */
export class TradingEngine {
    /**
     * @param {ConfigManager} config
     * @param {Connection} connection
     * @param {MarketDataProvider} marketData
     * @param {WalletManager} walletManager
     * @param {Logger} logger
     */
    constructor(config, connection, marketData, walletManager, logger) {
        this.config = config;
        this.connection = connection;
        this.marketData = marketData;
        this.walletManager = walletManager;
        this.logger = logger;
        this.trader = new SolanaTrade(this.config.rpcUrl);
        this.sentimentScore = 50;
        this.lastSentimentFetch = 0;
        this.limiter = pLimit(this.config.concurrency);
        this.cycleCount = 0;
    }

    /**
     * Gets random delay
     * @returns {number}
     */
    getRandomDelay() {
        return getJitteredValue(this.config.baseDelayMs, this.config.jitterPct);
    }

    /**
     /**
      * Fetches market sentiment
      * @returns {Promise<number>}
      */
     async fetchSentiment() {
         if (Date.now() - this.lastSentimentFetch < SENTIMENT_FETCH_COOLDOWN_MS) return this.sentimentScore;
         try {
             const response = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
             this.sentimentScore = parseInt(response.data.data[0].value);
             this.lastSentimentFetch = Date.now();
             this.logger.info('Sentiment updated', { score: this.sentimentScore });
         } catch (error) {
             this.logger.error('Sentiment fetch failed', { error: error.message });
         }
         return this.sentimentScore;
     }

    /**
     * Gets sentiment-based bias
     * @returns {number}
     */
    getSentimentBias() {
        const score = this.sentimentScore;
        if (score > 50) return 0.8;
        if (score < 30) return 0.3;
        return 0.5;
    }

    /**
     * Gets profile-adjusted amount
     * @param {Object} wallet
     * @param {boolean} isBuy
     * @returns {Promise<BN>}
     */
    async getProfileAdjustedAmount(wallet, isBuy) {
        let amount = new BN(this.config.swapAmount.toString());
        let maxCapMultiplier = 2;

        // Profile scaling
        if (this.config.behaviorProfile === 'whale') {
            amount = amount.mul(new BN(5));
            maxCapMultiplier = 5;
        } else if (this.config.behaviorProfile === 'mixed') {
            amount = amount.mul(new BN(Math.random() < 0.3 ? 3 : 1));
            maxCapMultiplier = 3;
        }

        // Personality scaling
        const personality = this.walletManager.getPersonality(wallet.keypair.publicKey);
        if (personality === 'hodler' && isBuy) {
            amount = amount.mul(new BN(2));
            maxCapMultiplier = Math.max(maxCapMultiplier, 4);
        } else if (personality === 'momentum') {
            amount = amount.mul(new BN(Math.floor((await this.fetchSentiment()) / 50)));
            maxCapMultiplier = Math.max(maxCapMultiplier, 4);
        }

        if (!isBuy) {
            amount = await this.getCurrentMemeBalance(wallet);
        }

        if (isBuy) {
            const maxAmount = new BN(this.config.swapAmount.toString()).mul(new BN(maxCapMultiplier));
            amount = amount.lt(maxAmount) ? amount : maxAmount;
        }

        return amount;
    }

    /**
     * Gets current meme token balance
     * @param {Object} wallet
     * @returns {Promise<BN>}
     */
    async getCurrentMemeBalance(wallet) {
        const tokenAccount = getAssociatedTokenAddressSync(this.config.memeCoinMint, wallet.keypair.publicKey);
        try {
            const accountInfo = await getAccount(this.connection, tokenAccount);
            return new BN(accountInfo.amount.toString());
        } catch {
            return new BN('0');
        }
    }

    /**
     * Gets adaptive amount with market adjustments
     * @param {Object} wallet
     * @param {boolean} isBuy
     * @param {BN} baseAmount
     * @returns {Promise<BN>}
     */
    async getAdaptiveAmount(wallet, isBuy, baseAmount) {
        let amount = new BN(baseAmount.toString());
        const vol = await this.marketData.fetchVolatility();

        if (vol > this.config.volThreshold) amount = amount.mul(new BN(5)).div(new BN(10));
        else if (vol < 0.01) amount = amount.mul(new BN(15)).div(new BN(10));

        if (this.config.useBirdeye) {
            const marketData = await this.marketData.getMarketData();
            const liquidityRatio = marketData.liquidity / 10000;
            if (liquidityRatio < 1) amount = amount.mul(new BN(5)).div(new BN(10));
            else if (liquidityRatio > 10) amount = amount.mul(new BN(12)).div(new BN(10));
        }

        return amount;
    }

    /**
     * Gets trade actions for a wallet cycle
     * @param {Object} wallet
     * @returns {Array<boolean>}
     */
    getTradeActions(wallet) {
        if (this.config.tradeMode === 'buy_only') {
            return Array(this.config.numActionsPerCycle).fill(true);
        } else if (this.config.tradeMode === 'sell_only') {
            return Array(this.config.numActionsPerCycle).fill(false);
        } else if (this.config.tradeMode === 'buy_first') {
            return [true, ...Array(this.config.numActionsPerCycle - 1).fill(false)];
        } else if (this.config.tradeMode === 'sell_first') {
            return [false, ...Array(this.config.numActionsPerCycle - 1).fill(true)];
        } else if (this.config.tradeMode === 'random') {
            return Array.from({ length: this.config.numActionsPerCycle }, () => Math.random() < this.config.buyProb);
        } else { // adaptive
            const buyFirst = this.isBuyFirst(wallet);
            const baseActions = buyFirst ? [true, false] : [false, true];
            const actions = [];
            for (let i = 0; i < this.config.numActionsPerCycle; i++) {
                actions.push(baseActions[i % baseActions.length]);
            }
            return actions;
        }
    }

    /**
     * Determines if wallet should buy first
     * @param {Object} wallet
     * @returns {boolean}
     */
    isBuyFirst(wallet) {
        const sentimentBias = this.getSentimentBias();
        const personality = this.walletManager.getPersonality(wallet.keypair.publicKey);
        let prob = this.config.buyProb * sentimentBias;
        if (personality === 'hodler') prob = Math.min(0.9, prob * 1.5);
        else if (personality === 'flipper') prob = 0.5;
        else if (personality === 'momentum') prob = Math.min(1.0, prob * 1.2);
        return Math.random() < prob;
    }

    /**
     * Performs TWAP (Time-Weighted Average Price) swap
     * @param {boolean} isBuy
     * @param {Object} wallet
     * @param {BN} amount
     * @returns {Promise<boolean>}
     */
    async twapSwap(isBuy, wallet, amount) {
        const partAmount = amount.div(new BN(this.config.twapParts));
        const remainder = amount.mod(new BN(this.config.twapParts));
        const parts = Array(this.config.twapParts).fill(partAmount);
        parts[0] = parts[0].add(remainder);

        let anySuccess = false;
        for (let i = 0; i < parts.length; i++) {
            if (!this.isRunning) break;
            const part = await this.getAdaptiveAmount(wallet, isBuy, parts[i]);
            if (part.lte(new BN('0'))) continue;

            this.logger.info(`${wallet.name} TWAP part ${i + 1}/${parts.length}`, {
                action: isBuy ? 'Buy' : 'Sell',
                amount: (part.div(new BN(LAMPORTS_PER_SOL.toString())).toNumber()).toFixed(6)
            });

            const success = await this.performSingleSwap(isBuy, wallet, part);
            if (success) anySuccess = true;
            if (!success) break;

            if (i < parts.length - 1) {
                const partDelay = Math.random() * this.config.twapMaxDelay;
                await delay(partDelay);
            }
        }
        return anySuccess;
    }

    /**
     * Performs a single swap
     * @param {boolean} isBuy
     * @param {Object} wallet
     * @param {BN} amount
     * @returns {Promise<boolean>}
     */
    async performSingleSwap(isBuy, wallet, amount) {
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const slippage = this.config.behaviorProfile === 'retail' ? DEFAULT_SLIPPAGE_RETAIL : DEFAULT_SLIPPAGE_WHALE;
                let sig;

                const jitoConfig = this.config.enableJito ? {
                    sender: 'JITO',
                    antimev: true,
                    priorityFeeSol: Number(this.config.jitoFee) / Number(LAMPORTS_PER_SOL),
                    tipAmountSol: isBuy ? Number(this.config.jitoTipBuy) / Number(LAMPORTS_PER_SOL) : Number(this.config.jitoTipSell) / Number(LAMPORTS_PER_SOL)
                } : {};

                if (isBuy) {
                    const solAmount = amount.div(new BN(LAMPORTS_PER_SOL.toString())).toString();
                    sig = await this.trader.buy({
                        market: this.config.market,
                        wallet: wallet.keypair,
                        mint: this.config.memeCoinMint,
                        amount: solAmount,
                        slippage,
                        ...jitoConfig
                    });
                } else {
                    sig = await this.trader.sell({
                        market: this.config.market,
                        wallet: wallet.keypair,
                        mint: this.config.memeCoinMint,
                        amount: amount.toString(),
                        slippage,
                        ...jitoConfig
                    });
                }

                this.logger.info(`${wallet.name} Swap TX`, {
                    tx: `https://solscan.io/tx/${sig}`,
                    action: isBuy ? 'Buy' : 'Sell'
                });

                return !!sig;
            } catch (error) {
                if (attempt === maxRetries - 1) throw error;
                await delay(Math.pow(2, attempt) * 1000); // exponential backoff
            }
        }
    }

    /**
     * Performs a swap with partial sell logic
     * @param {boolean} isBuy
     * @param {Object} wallet
     * @returns {Promise<boolean>}
     */
    async performSwap(isBuy, wallet) {
        await this.fetchSentiment();

        // Partial sell logic
        if (!isBuy && this.config.partialSellEnabled) {
            const currentTokens = await this.getCurrentMemeBalance(wallet);
            if (currentTokens.lt(MIN_MEME_TOKENS)) return false;

            const pct = this.config.partialSellMin + Math.random() * (this.config.partialSellMax - this.config.partialSellMin);
            const pctBigInt = new BN(Math.floor(pct * 100));
            const sellAmountBigInt = currentTokens.mul(pctBigInt).div(new BN(100));

            return await this.performSingleSwap(false, wallet, sellAmountBigInt);
        }

        const baseAmount = await this.getProfileAdjustedAmount(wallet, isBuy);
        const adjustedAmount = await this.getAdaptiveAmount(wallet, isBuy, baseAmount);
        const rampFactor = Math.min(1, (this.cycleCount + 1) / this.config.rampCycles);
        const finalAmount = adjustedAmount.mul(new BN(Math.floor(rampFactor * 100))).div(new BN(100));

        if (finalAmount.lte(new BN('0'))) {
            this.logger.info(`${wallet.name} Skipping: No balance`);
            return false;
        }

        const amountInSol = isBuy ? Number(finalAmount.div(new BN(LAMPORTS_PER_SOL.toString())).toNumber()) : 0;
        const marketCheck = await this.marketData.checkMarketConditions(amountInSol);

        if (!marketCheck.safe) {
            this.logger.warn(`${wallet.name} Trade skipped`, { reason: marketCheck.reason, sentiment: this.sentimentScore, impact: marketCheck.priceImpact });
            return false;
        }

        const personality = this.walletManager.getPersonality(wallet.keypair.publicKey);
        if (personality === 'hodler' && isBuy && Math.random() < 0.3) {
            this.logger.info(`${wallet.name} Hodling: Skipping sell cycle`);
            return true;
        }

        const useTwap = isBuy ? Number(finalAmount.div(new BN(LAMPORTS_PER_SOL.toString())).toNumber()) > 0.005 : Number(finalAmount.toNumber()) > 1000000;
        if (useTwap) {
            return await this.twapSwap(isBuy, wallet, finalAmount);
        } else {
            return await this.performSingleSwap(isBuy, wallet, finalAmount);
        }
    }

    /**
     * Processes a wallet cycle
     * @param {Object} wallet
     * @param {CircuitBreaker} circuitBreaker
     * @returns {Promise<Object>}
     */
    async processWalletCycle(wallet, circuitBreaker) {
        try {
            const balance = BigInt(await this.connection.getBalance(wallet.keypair.publicKey));
            if (balance < BigInt(Math.floor(0.01 * Number(LAMPORTS_PER_SOL)))) {
                this.logger.warn(`${wallet.name} low balance, skipping`);
                return { success: false, volume: 0 };
            }

            const walletKey = wallet.keypair.publicKey.toBase58();
            const tradeCount = this.walletManager.walletTradeCount.get(walletKey) || 0;

            let cycleVolume = 0;
            const actions = this.getTradeActions(wallet);
            this.logger.info(`${wallet.name} Cycle actions`, {
                actions: actions.map(a => a ? 'Buy' : 'Sell').join(', '),
                trades: tradeCount
            });

            for (const isBuy of actions) {
                if (!isBuy) {
                    const tokens = await this.getCurrentMemeBalance(wallet);
                    if (tokens.lt(MIN_MEME_TOKENS)) {
                        this.logger.info(`${wallet.name} No tokens to sell, skipping`);
                        continue;
                    }
                }

                const balanceBefore = BigInt(await this.connection.getBalance(wallet.keypair.publicKey));
                const solBefore = new BN(balanceBefore.toString());
                const success = await this.performSwap(isBuy, wallet);
                if (success) {
                    const balanceAfter = BigInt(await this.connection.getBalance(wallet.keypair.publicKey));
                    const solAfter = new BN(balanceAfter.toString());
                    const solDelta = isBuy ? solBefore.sub(solAfter) : solAfter.sub(solBefore);
                    cycleVolume += solDelta.div(new BN(LAMPORTS_PER_SOL.toString())).toNumber();
                    circuitBreaker.recordTradeResult(true);
                } else {
                    circuitBreaker.recordTradeResult(false);
                }

                await delay(this.getRandomDelay());
            }

            this.walletManager.markWalletUsed(wallet);
            this.totalVolume += cycleVolume;
            this.logger.info(`${wallet.name} completed`, { volume: cycleVolume.toFixed(2), totalVolume: this.totalVolume.toFixed(2) });

            return { success: true, volume: cycleVolume };
        } catch (error) {
            this.logger.error(`${wallet.name} Cycle failed`, { error: error.message });
            circuitBreaker.recordTradeResult(false);
            return { success: false, volume: 0 };
        }
    }
}