import axios from 'axios';
import { MARKET_DATA_CACHE_DURATION_MS } from '../constants.js';

/**
 * Market Data Provider with Multi-Tier Fallback
 */
export class MarketDataProvider {
    /**
     * @param {ConfigManager} config
     * @param {Connection} connection
     * @param {Logger} logger
     */
    constructor(config, connection, logger) {
        this.config = config;
        this.connection = connection;
        this.logger = logger;
        this.cache = {
            price: 0,
            priceChange24h: 0,
            volume24h: 0,
            liquidity: 0,
            lastUpdate: 0,
            source: 'none',
        };
        this.cacheDuration = MARKET_DATA_CACHE_DURATION_MS;
        this.axiosConfig = {
            timeout: 8000,
            headers: this.config.useBirdeye ? { 'X-API-KEY': this.config.birdeyeApiKey } : {}
        };
        this.lastApiCall = 0;
        this.apiCallInterval = 1000; // 1 second between API calls
    }

    /**
     * Gets market data using tiered fallback system
     * @returns {Promise<Object>}
     */
    async getMarketData() {
        const now = Date.now();
        if (now - this.cache.lastUpdate < this.cacheDuration) {
            return this.cache;
        }

        // Rate limiting
        const timeSinceLastCall = now - this.lastApiCall;
        if (timeSinceLastCall < this.apiCallInterval) {
            await new Promise(resolve => setTimeout(resolve, this.apiCallInterval - timeSinceLastCall));
        }
        this.lastApiCall = Date.now();

        // Tier 1: Birdeye
        if (this.config.useBirdeye) {
            try {
                const response = await axios.get(
                    `https://public-api.birdeye.so/defi/price?address=${this.config.memeCoinMint.toBase58()}&include_liquidity=true&include_volume=true`,
                    this.axiosConfig
                );

                if (response.data.success && response.data.data) {
                    const data = response.data.data;
                    this.cache = {
                        price: data.value,
                        priceChange24h: data.priceChange24h,
                        volume24h: data.volumeH24,
                        liquidity: data.liquidity,
                        lastUpdate: now,
                        source: 'Birdeye',
                    };
                    this.logger.info('Market data fetched from Birdeye', {
                        price: this.cache.price,
                        liquidity: this.cache.liquidity
                    });
                    return this.cache;
                }
            } catch (error) {
                this.logger.warn('Birdeye fetch failed, falling back', { error: error.message });
            }
        }

        // Tier 2: DexScreener
        if (this.config.memeCoinPairAddress) {
            try {
                const response = await axios.get(
                    `https://api.dexscreener.com/latest/dex/pairs/solana/${this.config.memeCoinPairAddress}`,
                    { timeout: this.axiosConfig.timeout }
                );

                if (response.data && response.data.pair) {
                    const pair = response.data.pair;
                    this.cache = {
                        price: parseFloat(pair.priceUsd),
                        priceChange24h: parseFloat(pair.priceChange.h24),
                        volume24h: parseFloat(pair.volume.h24),
                        liquidity: parseFloat(pair.liquidity.usd),
                        lastUpdate: now,
                        source: 'DexScreener',
                    };
                    this.logger.info('Market data fetched from DexScreener', {
                        price: this.cache.price,
                        liquidity: this.cache.liquidity
                    });
                    return this.cache;
                }
            } catch (error) {
                this.logger.warn('DexScreener fetch failed, falling back', { error: error.message });
            }
        }

        // Tier 3: CoinGecko
        try {
            const response = await axios.get(
                `https://api.coingecko.com/api/v3/simple/price?ids=${this.config.memeCoinSymbol}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`,
                { timeout: this.axiosConfig.timeout }
            );

            if (response.data && response.data[this.config.memeCoinSymbol]) {
                const data = response.data[this.config.memeCoinSymbol];
                const lastLiquidity = this.cache.liquidity || 0;

                this.cache = {
                    price: data.usd,
                    priceChange24h: data.usd_24h_change,
                    volume24h: data.usd_24h_vol,
                    liquidity: lastLiquidity,
                    lastUpdate: now,
                    source: 'CoinGecko',
                };
                this.logger.info('Market data fetched from CoinGecko (stale liquidity)', {
                    price: this.cache.price,
                    liquidity: this.cache.liquidity
                });
                return this.cache;
            }
        } catch (error) {
            this.logger.error('All market data sources failed', { error: error.message });
        }

        return this.cache; // Return stale data
    }

    /**
     * Gets SOL price in USD
     * @returns {Promise<number>}
     */
    async getSolPriceUsd() {
        // Tier 1: DexScreener
        try {
            const response = await axios.get(
                'https://api.dexscreener.com/latest/dex/pairs/solana/So11111111111111111111111111111111111111112_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                { timeout: this.axiosConfig.timeout }
            );
            if (response.data && response.data.pair) {
                return parseFloat(response.data.pair.priceUsd);
            }
        } catch (error) {
            this.logger.warn('SOL price DexScreener failed, falling back', { error: error.message });
        }

        // Tier 2: CoinGecko
        try {
            const response = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
                { timeout: this.axiosConfig.timeout }
            );
            if (response.data && response.data.solana) {
                return response.data.solana.usd;
            }
        } catch (error) {
            this.logger.error('SOL price CoinGecko failed', { error: error.message });
        }

        return 150; // Fallback
    }

    /**
     * Fetches volatility data
     * @returns {Promise<number>}
     */
    async fetchVolatility() {
        try {
            const response = await axios.get(
                `https://api.coingecko.com/api/v3/coins/${this.config.memeCoinSymbol}/market_chart?vs_currency=usd&days=7`,
                { timeout: this.axiosConfig.timeout }
            );

            if (response.data && response.data.prices && response.data.prices.length > 1) {
                const prices = response.data.prices.map(p => p[1]);
                const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
                if (returns.length < 2) return 0;
                const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
                return Math.sqrt(variance);
            }
        } catch (error) {
            this.logger.error('Volatility fetch failed', { error: error.message });
        }
        return 0;
    }

    /**
     * Estimates price impact
     * @param {number} amountInSol
     * @returns {Promise<number>}
     */
    async estimatePriceImpact(amountInSol) {
        await this.getMarketData();
        const solPriceUsd = await this.getSolPriceUsd();
        const amountInUsd = amountInSol * solPriceUsd;
        const liquidity = this.cache.liquidity;

        if (liquidity === 0) return 100;
        const impact = (amountInUsd / liquidity) * 100;
        return Math.min(impact, 100);
    }

    /**
     * Checks if market conditions are safe for trading
     * @param {number} amountInSol
     * @returns {Promise<Object>}
     */
    async checkMarketConditions(amountInSol) {
        await this.getMarketData();

        if (this.cache.liquidity < this.config.minLiquidity) {
            return {
                safe: false,
                reason: `Low liquidity: $${this.cache.liquidity.toFixed(0)} < $${this.config.minLiquidity} (Source: ${this.cache.source})`,
            };
        }

        const priceImpact = await this.estimatePriceImpact(amountInSol);
        if (priceImpact > this.config.maxPriceImpact) {
            return {
                safe: false,
                reason: `High price impact: ${priceImpact.toFixed(2)}% > ${this.config.maxPriceImpact}%`,
            };
        }

        return { safe: true, reason: '', priceImpact };
    }
}