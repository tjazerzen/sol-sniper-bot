# Solana Sniper Bot

This code is written as proof of concept to demonstrate how we can buy new tokens immediately after the liquidity pool is open for trading.

Script listens to new Raydium USDC or SOL pools and buys tokens for a fixed amount in USDC/SOL. Depending on the speed of the RPC node, the purchase usually happens before the token is available on Raydium UI for swapping.

The bot implements two strategies:

- Buy new tokens and sell them after two different gain percentages.
- Buy new tokens and sell them after a specified delay.

## Setup

To run the script you need to:

- Create a new empty Solana wallet
- Transfer some SOL to it.
- Convert some SOL to USDC or WSOL.
  - You need USDC or WSOL depending on the configuration set below.
- Configure the script by updating `.env.copy` file (remove the .copy from the file name when done).
  - Check [Configuration](#configuration) section bellow
- Install dependencies by typing: `npm install`
- Run the script by typing: `npm run start` in terminal

You should see the following output:
![output](readme/output.png)

### Configuration

#### Wallet

- `PRIVATE_KEY` - Your wallet's private key.

#### Connection

- `RPC_ENDPOINT` - HTTPS RPC endpoint for interacting with the Solana network.
- `RPC_WEBSOCKET_ENDPOINT` - WebSocket RPC endpoint for real-time updates from the Solana network.
- `COMMITMENT_LEVEL`- The commitment level of transactions (e.g., "finalized" for the highest level of security).

The transactions are executed on Solana's mainnet-beta network.

#### Bot

- `LOG_LEVEL` - Set logging level, e.g., `info`, `debug`, `trace`, etc.
- `ONE_TOKEN_AT_A_TIME` - Set to `true` to process buying one token at a time.
- `PRE_LOAD_EXISTING_MARKETS` - Bot will load all existing markets in memory on start.
- `CACHE_NEW_MARKETS` - Set to `true` to cache new markets.
  - This option should not be used with public RPC.
- `TRANSFER_AFTER_PROFIT` - Set to `true` to transfer a portion of the profit to the some other wallet.
- `TAKE_PROFIT_FEE_PERCENTAGE` - Percentage of profit to transfer to the other wallet.
- `TAKE_PROFIT_TRANSFER_WALLET_PUBLIC_ADDRESS` - Public address of the wallet to transfer the allocated profit.

#### Fees

- `COMPUTE_UNIT_LIMIT` - Compute limit used to calculate fees.
- `COMPUTE_UNIT_PRICE` - Compute price used to calculate fees.
  - This option should not be used with public RPC.

#### Buy

- `QUOTE_MINT` - Which pools to snipe, USDC or WSOL.
- `QUOTE_AMOUNT` - Amount used to buy each new token.
- `MAX_BUY_RETRIES` - Maximum number of retries for buying a token.
- `BUY_SLIPPAGE` - Slippage %

#### Sell

**General sell params**

- `MAX_SELL_RETRIES` - Maximum number of retries for selling a token.
- `STOP_LOSS` - Percentage loss at which to stop the loss.

  - Stop loss is calculated based on quote mint.
  - If you want to disable stop loss, set this to `0`.

- `SELL_SLIPPAGE` - Slippage %.

**Auto sell params**

- `AUTO_SELL` - Set to `true` to enable automatic selling of tokens.
  - If you want to manually sell bought tokens, disable this option.
- `AUTO_SELL_DELAY` - Delay in milliseconds before auto-selling a token.

  - If you don't reach profit or loss bot will auto sell after this time.
  - Set to zero to disable take profit and stop loss.

  **Take profit params**

- `TAKE_PROFIT` - Whether to take profit after a percentage gain. Set to `true` to enable. We employ a strategy of selling after two different gain percentages.
- `TAKE_PROFIT_1_AFTER_GAIN` - Percentage gain at which to take the first share of profit.
- `TAKE_PROFIT_1_PERCENTAGE` - Percentage of the profit to take after the first gain.
- `TAKE_PROFIT_2_AFTER_GAIN` - Percentage gain at which to take the second share of profit.
- `TAKE_PROFIT_2_PERCENTAGE` - Percentage of the profit to take after the second gain.

#### Filters

- `CHECK_IF_MUTABLE` - Set to `true` to buy tokens only if their metadata are not mutable.
- `CHECK_IF_MINT_IS_RENOUNCED` - Set to `true` to buy tokens only if their mint is renounced.
- `CHECK_IF_FREEZABLE` - Set to `true` to buy tokens only if they are not freezable.
- `CHECK_IF_BURNED` - Set to `true` to buy tokens only if their liquidity pool is burned.
- `MIN_POOL_SIZE` - Bot will buy only if the pool size is greater than or equal the specified amount.
  - Set `0` to disable.
- `MAX_POOL_SIZE` - Bot will buy only if the pool size is less than or equal the specified amount.
  - Set `0` to disable.

#### Checking for rugs

For checking rugs, we use rugcheck.xyz API. For every mint address, we check the coin rugcheck safety score. If the score is more than the specified threshold, the bot will not buy the token.

- `RUGCHECK_XYZ_CHECK` - Set to `true` to check for rugs.
- `RUGCHECK_XYZ_MAX_SCORE` - Maximum score for the token to be considered safe.

## Disclaimer

Use this script at your own risk.
