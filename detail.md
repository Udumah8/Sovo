# Detailed Instructions: Funding and Running the Volume Booster Bot

## Overview
This guide provides comprehensive instructions for setting up, funding, and running the Solana Volume Booster Bot. The bot generates multiple wallets, funds them automatically, and performs volume-boosting trades on Solana DEXes.

## Prerequisites

### System Requirements
- Node.js 16+ (check with `node --version`)
- npm (comes with Node.js)
- A Solana-compatible wallet (Phantom, Solflare, or CLI wallet)
- Sufficient SOL in your master wallet for funding bot wallets

### Security Warning
⚠️ **CRITICAL**: This bot handles cryptocurrency and private keys. Never commit private keys to version control. Use dedicated wallets for bot operations. Monitor transactions closely. Test on devnet first.

## Installation

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd volume-booster-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify installation**:
   ```bash
   npm test
   ```

## Configuration

### 1. Environment Setup
Copy the example configuration file:
```bash
cp .env.example .env
```

### 2. Required Configuration (.env file)

#### Network Configuration
```env
RPC_URL=https://api.mainnet-beta.solana.com
```
- Use mainnet for production trading
- Use `https://api.devnet.solana.com` for testing
- Consider premium RPC providers (Helius, QuickNode, Alchemy) for better performance

#### Token Configuration
```env
MEME_COIN_MINT=YOUR_MINT_ADDRESS_HERE
MEME_COIN_SYMBOL=pepe
MARKET=RAYDIUM_AMM
```
- `MEME_COIN_MINT`: The base58 mint address of your meme coin
- `MEME_COIN_SYMBOL`: CoinGecko ID (e.g., 'pepe', 'dogecoin')
- `MARKET`: DEX to trade on (RAYDIUM_AMM, PUMP_FUN, etc.)

#### Trading Strategy
```env
TRADE_MODE=adaptive
BUY_PROB=0.5
NUM_ACTIONS_PER_CYCLE=2
SWAP_AMOUNT=0.01
DELAY_MS=5000
JITTER_PCT=20
```

#### Wallet Generation
```env
NUM_WALLETS_TO_GENERATE=10
FUND_AMOUNT=0.02
```

### 3. Funding Configuration (CRITICAL)

#### Master Wallet Setup
You need a master wallet with sufficient SOL to fund all bot wallets:

```env
MASTER_PRIVATE_KEY=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64]
```

**How to get your private key as JSON array:**

1. **From Phantom/Solflare:**
   - Export your wallet private key
   - Convert to Uint8Array format (64 numbers)

2. **From Solana CLI:**
   ```bash
   solana-keygen pubkey ASK
   solana-keygen grind --ends-with <suffix>:1
   ```
   - The private key will be in `~/.config/solana/id.json`

3. **Convert to JSON array:**
   - Use online tools or scripts to convert base58/hex to JSON array
   - Example: `[1,2,3,...,64]`

**Funding Amount Calculation:**
- Each wallet needs: `FUND_AMOUNT` (default 0.02 SOL)
- For 10 wallets: 10 × 0.02 = 0.2 SOL minimum
- Add buffer for transaction fees: ~0.01 SOL per wallet
- **Total required**: ~0.3-0.5 SOL in master wallet

#### Optional: Withdrawal Wallet
```env
WITHDRAW_TO_PRIVATE_KEY=[1,2,3,...,64]
MIN_WITHDRAW_SOL=0.001
```
- Bot will automatically withdraw remaining funds to this wallet on stop

## Wallet Generation

Generate bot wallets:
```bash
node scripts/generate-wallets.js 10
```

This creates 10 new wallets and saves them to `wallets.json` (note: script says `SINK.json` but actually uses `wallets.json`).

**What happens:**
- Generates 10 Solana keypairs
- Saves public/private keys to JSON file
- Wallets are initially unfunded

## Funding the Wallets

### Automatic Funding
The bot automatically funds wallets when started, using your master wallet as a relayer.

**Requirements:**
- Master wallet must have sufficient SOL
- `MASTER_PRIVATE_KEY` must be set in `.env`
- RPC connection must be working

**Process:**
1. Bot checks each generated wallet balance
2. If balance < 80% of `FUND_AMOUNT`, it transfers SOL from master wallet
3. Uses randomized amounts and delays for stealth
4. Funds in parallel batches of 50 wallets

### Manual Funding (Alternative)
If automatic funding fails:

1. **Check wallet addresses:**
   ```bash
   cat wallets.json | jq -r '.[].pubkey'
   ```

2. **Fund manually** using Solana CLI or wallet app:
   ```bash
   solana transfer <wallet-address> 0.02 --allow-unfunded-recipient
   ```

3. **Verify funding:**
   ```bash
   solana balance <wallet-address>
   ```

## Running the Bot

### Start the Bot
```bash
npm start
```

**What happens on startup:**
1. Loads configuration from `.env`
2. Generates/funds wallets if needed
3. Initializes trading engine
4. Starts volume boosting cycle
5. Enables keyboard controls (if configured)

### Keyboard Controls
When running, you can use:
- `q`: Graceful shutdown
- `w`: Manual withdrawal of all funds

### Monitoring
- Bot logs to console and `bot.log`
- Monitor wallet balances and transaction success rates
- Check RPC rate limits and connection stability

## Stopping the Bot

### Graceful Shutdown
- Press `Ctrl+C` or type `q` in terminal
- Bot will:
  - Stop all trading activities
  - Withdraw remaining funds (if configured)
  - Save wallet states
  - Clean up resources

### Emergency Stop
If needed, force kill the process:
```bash
pkill -f "node bot.js"
```

## Advanced Configuration

### Performance Tuning
```env
CONCURRENCY=5
BATCH_SIZE=100
RETRY_ATTEMPTS=3
```

### Safety Features
```env
ENABLE_CIRCUIT_BREAKER=true
MAX_CONSECUTIVE_FAILURES=10
MAX_FAILURE_RATE_PCT=50
EMERGENCY_STOP_LOSS_PCT=30
```

### Jito MEV Protection
```env
ENABLE_JITO=true
JITO_PRIORITY_FEE_SOL=0.002
JITO_TIP_SOL_BUY=0.0012
JITO_TIP_SOL_SELL=0.0018
```

## Troubleshooting

### Common Issues

1. **Funding fails:**
   - Check master wallet balance
   - Verify `MASTER_PRIVATE_KEY` format
   - Ensure RPC is accessible

2. **RPC errors:**
   - Switch to premium RPC provider
   - Reduce `CONCURRENCY`
   - Add delays between requests

3. **Transaction failures:**
   - Check token mint address
   - Verify market configuration
   - Monitor gas fees

4. **Low success rate:**
   - Adjust `SWAP_AMOUNT`
   - Enable Jito protection
   - Check market liquidity

### Logs and Debugging
- Check `bot.log` for detailed errors
- Run with verbose logging: `DEBUG=* npm start`
- Test on devnet first

## Security Best Practices

1. **Never commit `.env` to git**
2. **Use dedicated master wallet**
3. **Start with small amounts**
4. **Monitor transactions closely**
5. **Enable all safety features**
6. **Regular backup of wallet files**
7. **Use hardware wallet for large amounts**

## Cost Estimation

### One-time Setup Costs
- SOL for funding: 0.02 × num_wallets
- RPC fees: Minimal for setup

### Ongoing Costs
- Transaction fees: ~0.000005 SOL per transaction
- Priority fees: 0.001-0.002 SOL per trade (if using Jito)
- RPC costs: Varies by provider

### Example for 10 wallets, 1000 trades/day:
- Funding: 0.2 SOL
- Daily fees: ~0.007 SOL
- Monthly: ~0.21 SOL

## Support

- Check logs for error messages
- Verify configuration against `.env.example`
- Test on devnet before mainnet
- Monitor Solana network status

Remember: This bot carries financial risk. Use at your own discretion and start small.