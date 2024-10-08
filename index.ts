import { MarketCache, PoolCache } from './cache';
import { Listeners } from './listeners';
import { Connection, KeyedAccountInfo, Keypair } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot, BotConfig } from './bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import {
  getToken,
  getWallet,
  logger,
  COMMITMENT_LEVEL,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  PRE_LOAD_EXISTING_MARKETS,
  LOG_LEVEL,
  CHECK_IF_MINT_IS_RENOUNCED,
  CHECK_IF_FREEZABLE,
  CHECK_IF_BURNED,
  QUOTE_MINT,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  QUOTE_AMOUNT,
  PRIVATE_KEY,
  ONE_TOKEN_AT_A_TIME,
  PRICE_CHECK_DURATION,
  PRICE_CHECK_INTERVAL,
  AUTO_SELL_DELAY,
  MAX_SELL_RETRIES,
  AUTO_SELL,
  MAX_BUY_RETRIES,
  COMPUTE_SET_CUSTOM_TIPS,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  CACHE_NEW_MARKETS,
  STOP_LOSS,
  BUY_SLIPPAGE,
  SELL_SLIPPAGE,
  TRANSFER_AFTER_PROFIT,
  RUGCHECK_XYZ_CHECK,
  RUGCHECK_XYZ_MAX_SCORE,
  TAKE_PROFIT_1_AFTER_GAIN,
  TAKE_PROFIT_2_AFTER_GAIN,
  TAKE_PROFIT_1_PERCENTAGE,
  TAKE_PROFIT_2_PERCENTAGE,
  TAKE_PROFIT_FEE_PERCENTAGE,
  TAKE_PROFIT,
} from './helpers';
// import { version } from './package.json';
import { ProfitTransferExecutor } from './transactions/profit-transaction-executor';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

function printDetails(wallet: Keypair, quoteToken: Token, bot: Bot) {
  const botConfig = bot.config;

  logger.info('------- CONFIGURATION START -------');
  logger.info(`Wallet: ${wallet.publicKey.toString()}`);

  logger.info('- Bot -');

  logger.info(`Transfer after profit: ${TRANSFER_AFTER_PROFIT}`);
  logger.info(`Set custom tips for transactions: ${botConfig.setCustomTips}`);
  if (botConfig.setCustomTips) {
    logger.info(`Compute Unit limit: ${botConfig.unitLimit}`);
    logger.info(`Compute Unit price (micro lamports): ${botConfig.unitPrice}`);
  }

  logger.info(`Single token at the time: ${botConfig.oneTokenAtATime}`);
  logger.info(`Pre load existing markets: ${PRE_LOAD_EXISTING_MARKETS}`);
  logger.info(`Cache new markets: ${CACHE_NEW_MARKETS}`);
  logger.info(`Log level: ${LOG_LEVEL}`);

  logger.info('- Price check -');
  logger.info(`Price check duration: ${botConfig.priceCheckDuration} ms`);
  logger.info(`Price check interval: ${botConfig.priceCheckInterval} ms`);

  logger.info('- Buy -');
  logger.info(`Buy amount: ${botConfig.quoteAmount.toFixed()} ${botConfig.quoteToken.name}`);
  logger.info(`Max buy retries: ${botConfig.maxBuyRetries}`);
  logger.info(`Buy amount (${quoteToken.symbol}): ${botConfig.quoteAmount.toFixed()}`);
  logger.info(`Buy slippage: ${botConfig.buySlippage}%`);

  logger.info('- Sell -');
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Auto sell delay: ${botConfig.autoSellDelay} ms`);
  logger.info(`Max sell retries: ${botConfig.maxSellRetries}`);
  logger.info(`Sell slippage: ${botConfig.sellSlippage}%`);
  logger.info(`Take profit after gain - first: ${botConfig.takeProfit1AfterGain}%`);
  logger.info(`Take profit percentage - first: ${botConfig.takeProfit1Percentage}%`);
  logger.info(`Take profit after gain - second: ${botConfig.takeProfit2AfterGain}%`);
  logger.info(`Take profit percentage - second: ${botConfig.takeProfit2Percentage}%`);
  logger.info(`Stop loss: ${botConfig.stopLoss}%`);

  logger.info('- Filters -');
  logger.info(`Check renounced: ${botConfig.checkRenounced}`);
  logger.info(`Check freezable: ${botConfig.checkFreezable}`);
  logger.info(`Check burned: ${botConfig.checkBurned}`);
  logger.info(`Min pool size: ${botConfig.minPoolSize.toFixed()}`);
  logger.info(`Max pool size: ${botConfig.maxPoolSize.toFixed()}`);

  logger.info('------- CONFIGURATION END -------');

  logger.info('Bot is running! Press CTRL + C to stop it.');
}

const runListener = async () => {
  logger.level = LOG_LEVEL;
  logger.info('Bot is starting...');

  const marketCache = new MarketCache(connection);
  const poolCache = new PoolCache();
  let txExecutor: TransactionExecutor;

  if (TRANSFER_AFTER_PROFIT) {
    txExecutor = new ProfitTransferExecutor(connection);
  } else {
    txExecutor = new DefaultTransactionExecutor(connection);
  }

  const wallet = getWallet(PRIVATE_KEY.trim());
  const quoteToken = getToken(QUOTE_MINT);
  const botConfig = <BotConfig>{
    wallet,
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
    checkRenounced: CHECK_IF_MINT_IS_RENOUNCED,
    checkFreezable: CHECK_IF_FREEZABLE,
    checkBurned: CHECK_IF_BURNED,
    minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
    maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    oneTokenAtATime: ONE_TOKEN_AT_A_TIME,
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    priceCheckDuration: PRICE_CHECK_DURATION,
    priceCheckInterval: PRICE_CHECK_INTERVAL,
    maxSellRetries: MAX_SELL_RETRIES,
    maxBuyRetries: MAX_BUY_RETRIES,
    setCustomTips: COMPUTE_SET_CUSTOM_TIPS,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    takeProfit1AfterGain: TAKE_PROFIT_1_AFTER_GAIN,
    takeProfit1Percentage: TAKE_PROFIT_1_PERCENTAGE,
    takeProfit2AfterGain: TAKE_PROFIT_2_AFTER_GAIN,
    takeProfit2Percentage: TAKE_PROFIT_2_PERCENTAGE,
    takeProfitFeePercentage: TAKE_PROFIT_FEE_PERCENTAGE,
    stopLoss: STOP_LOSS,
    buySlippage: BUY_SLIPPAGE,
    sellSlippage: SELL_SLIPPAGE,
    rugcheckXyzCheck: RUGCHECK_XYZ_CHECK,
    rugcheckXyzMaxScore: RUGCHECK_XYZ_MAX_SCORE,
  };

  const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);
  const valid = await bot.validate();

  if (!valid) {
    logger.info('Bot is exiting...');
    process.exit(1);
  }

  if (PRE_LOAD_EXISTING_MARKETS) {
    await marketCache.init({ quoteToken });
  }

  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const listeners = new Listeners(connection);
  await listeners.start({
    walletPublicKey: wallet.publicKey,
    quoteToken,
    autoSell: AUTO_SELL,
    cacheNewMarkets: CACHE_NEW_MARKETS,
  });

  listeners.on('market', (updatedAccountInfo: KeyedAccountInfo) => {
    const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
    marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
  });

  listeners.on('pool', async (updatedAccountInfo: KeyedAccountInfo) => {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
    const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
    const exists = await poolCache.get(poolState.baseMint.toString());

    if (!exists && poolOpenTime > runTimestamp) {
      poolCache.save(updatedAccountInfo.accountId.toString(), poolState);
      await bot.buy(updatedAccountInfo.accountId, poolState);
    }
  });

  listeners.on('wallet', async (updatedAccountInfo: KeyedAccountInfo) => {
    const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo.data);

    if (accountData.mint.equals(quoteToken.mint)) {
      return;
    }

    await bot.sell(updatedAccountInfo.accountId, accountData);
  });

  printDetails(wallet, quoteToken, bot);
};

runListener();
