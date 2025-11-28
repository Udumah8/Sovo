import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Application Constants
 * Centralized magic numbers and configuration values
 */

// Solana Constants
export const LAMPORTS_PER_SOL = 1000000000;
export const LAMPORTS_PER_SOL_BN = new BN(LAMPORTS_PER_SOL.toString());
export const MIN_SOL_BUFFER = 0.0005;
export const MIN_SOL_BUFFER_LAMPORTS = BigInt(Math.floor(MIN_SOL_BUFFER * LAMPORTS_PER_SOL));
export const MIN_SOL_BUFFER_LAMPORTS_BN = new BN(MIN_SOL_BUFFER_LAMPORTS.toString());
export const MIN_TRANSFER_SOL = 0.0001;
export const MIN_TRANSFER_LAMPORTS = BigInt(Math.floor(MIN_TRANSFER_SOL * LAMPORTS_PER_SOL));

// Priority Fees
export const PRIORITY_FEE_MICRO_LAMPORTS = 10000;

// Time Constants
export const MAX_COOLDOWN_AGE_HOURS = 24;
export const MAX_COOLDOWN_AGE_MS = MAX_COOLDOWN_AGE_HOURS * 60 * 60 * 1000;

// Trading Constants
export const MIN_MEME_TOKENS = BigInt('1000000');
export const DEFAULT_SLIPPAGE_RETAIL = 1.0;
export const DEFAULT_SLIPPAGE_WHALE = 0.3;

// Market Data Constants
export const MARKET_DATA_CACHE_DURATION_MS = 60000; // 1 minute
export const SENTIMENT_FETCH_COOLDOWN_MS = 3600000; // 1 hour

// File Constants
export const DEFAULT_WALLET_FILE = 'wallets.json';

// Burn Address for Seasoning
export const BURN_ADDRESS = new PublicKey('1nc1nerator11111111111111111111111111111111');

// USDC Mint
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Behavior Constants
export const PERSONALITIES = ['flipper', 'hodler', 'momentum'];
export const BEHAVIOR_PROFILES = ['retail', 'whale', 'mixed'];
export const TRADE_MODES = ['adaptive', 'buy_first', 'sell_first', 'buy_only', 'sell_only', 'random'];

// Market Types
export const SUPPORTED_MARKETS = [
  'PUMP_FUN', 'PUMP_SWAP', 'RAYDIUM_AMM', 'RAYDIUM_CLMM', 'RAYDIUM_CPMM',
  'RAYDIUM_LAUNCHPAD', 'ORCA_WHIRLPOOL', 'METEORA_DLMM', 'METEORA_DAMM_V1',
  'METEORA_DAMM_V2', 'METEORA_DBC', 'MOONIT', 'HEAVEN', 'SUGAR', 'BOOP_FUN'
];