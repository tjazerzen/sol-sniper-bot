import {
  BigNumberish,
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  LiquidityStateV4,
  MARKET_STATE_LAYOUT_V3,
  MarketStateV3,
  Token,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Keypair,
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  KeyedAccountInfo,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getTokenAccounts,
  RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
  OPENBOOK_PROGRAM_ID,
  createPoolKeys,
  fetchCoinPrice,
} from './liquidity';
import { logger } from './utils';
import { getMinimalMarketV3, MinimalMarketLayoutV3 } from './market';
import { MintLayout } from './types';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import {
  CHECK_IF_MINT_IS_RENOUNCED,
  COMMITMENT_LEVEL,
  LOG_LEVEL,
  MAX_SELL_RETRIES,
  NETWORK,
  PRIVATE_KEY,
  QUOTE_AMOUNT,
  QUOTE_MINT,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  MIN_POOL_SIZE,
  MAX_POOL_SIZE,
  ONE_TOKEN_AT_A_TIME,
  SELL_AFTER_GAIN_PERCENTAGE,
  AUTO_SELL,
  SELL_AFTER_GAIN,
  AUTO_SELL_DELAY,
  RUGPULL_CHECK,
} from './constants';
import BN from 'bn.js';
import { getTokenMetadata } from './check-rugpulls';

const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

export interface MinimalTokenAccountData {
  mint: PublicKey;
  address: PublicKey;
  amount: BN;
  poolKeys?: LiquidityPoolKeys;
  market?: MinimalMarketLayoutV3;
  purchasePrice?: number;
}

const existingLiquidityPools: Set<string> = new Set<string>();
const existingOpenBookMarkets: Set<string> = new Set<string>();
const existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();

let wallet: Keypair;
let quoteToken: Token;
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;
let quoteMinPoolSizeAmount: TokenAmount;
let quoteMaxPoolSizeAmount: TokenAmount;
let processingToken: Boolean = false;

async function init(): Promise<void> {
  logger.level = LOG_LEVEL;

  // get wallet
  wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  logger.info(`Wallet Address: ${wallet.publicKey}`);

  // get quote mint and amount
  switch (QUOTE_MINT) {
    case 'WSOL': {
      quoteToken = Token.WSOL;
      quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
      quoteMinPoolSizeAmount = new TokenAmount(quoteToken, MIN_POOL_SIZE, false);
      quoteMaxPoolSizeAmount = new TokenAmount(quoteToken, MAX_POOL_SIZE, false);
      break;
    }
    case 'USDC': {
      quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
      quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
      quoteMinPoolSizeAmount = new TokenAmount(quoteToken, MIN_POOL_SIZE, false);
      quoteMaxPoolSizeAmount = new TokenAmount(quoteToken, MAX_POOL_SIZE, false);
      break;
    }
    default: {
      throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
    }
  }

  logger.info(`Check mint renounced: ${CHECK_IF_MINT_IS_RENOUNCED}`);
  logger.info(
    `Min pool size: ${quoteMinPoolSizeAmount.isZero() ? 'false' : quoteMinPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
  );
  logger.info(
    `Max pool size: ${quoteMaxPoolSizeAmount.isZero() ? 'false' : quoteMaxPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
  );
  logger.info(`One token at a time: ${ONE_TOKEN_AT_A_TIME}`);
  logger.info(`Buy amount: ${quoteAmount.toFixed()} ${quoteToken.symbol}`);

  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Sell delay: ${AUTO_SELL_DELAY === 0 ? 'false' : AUTO_SELL_DELAY}`);

  logger.info(`Sell after gain: ${SELL_AFTER_GAIN}`);
  logger.info(`Sell after gain percentage: ${SELL_AFTER_GAIN_PERCENTAGE * 100}%`);

  logger.info(`Rugpull check: ${RUGPULL_CHECK}`);

  // check existing wallet for associated token account of quote mint
  const tokenAccounts = await getTokenAccounts(solanaConnection, wallet.publicKey, COMMITMENT_LEVEL);

  for (const ta of tokenAccounts) {
    existingTokenAccounts.set(ta.accountInfo.mint.toString(), <MinimalTokenAccountData>{
      mint: ta.accountInfo.mint,
      address: ta.pubkey,
      amount: ta.amount,
      purchasePrice: ta.price,
    });
  }

  const tokenAccount = tokenAccounts.find((acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString());

  if (!tokenAccount) {
    throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
  }

  quoteTokenAssociatedAddress = tokenAccount.pubkey;
}

async function getTokenAccount(mint: PublicKey, accountData: MinimalMarketLayoutV3): Promise<MinimalTokenAccountData> {
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const tokenAccount = <MinimalTokenAccountData>{
    address: ata,
    mint: mint,
    market: <MinimalMarketLayoutV3>{
      bids: accountData.bids,
      asks: accountData.asks,
      eventQueue: accountData.eventQueue,
    },
    purchasePrice: undefined,
  };
  return tokenAccount;
}

export async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {
  logger.info(`-------------------🤖🔧------------------- `);
  logger.info(`Processing token: ${processingToken}`);
  const shouldBuy = ONE_TOKEN_AT_A_TIME ? !processingToken : true;
  if (!shouldBuy) {
    return;
  }

  if (!quoteMinPoolSizeAmount.isZero()) {
    const poolSize = new TokenAmount(quoteToken, poolState.swapQuoteInAmount, true);
    logger.info(`Processing pool: ${id.toString()} with ${poolSize.toFixed()} ${quoteToken.symbol} in liquidity`);

    if (poolSize.lt(quoteMinPoolSizeAmount)) {
      logger.warn(
        {
          mint: poolState.baseMint,
          pooled: `${poolSize.toFixed()} ${quoteToken.symbol}`,
        },
        `Skipping pool, smaller than ${quoteMinPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
        `Swap quote in amount: ${poolSize.toFixed()}`,
      );
      logger.info(`-------------------🤖🔧------------------- \n`);
      return;
    }
  }

  if (!quoteMaxPoolSizeAmount.isZero()) {
    const poolSize = new TokenAmount(quoteToken, poolState.swapQuoteInAmount, true);

    if (poolSize.gt(quoteMaxPoolSizeAmount)) {
      logger.warn(
        {
          mint: poolState.baseMint,
          pooled: `${poolSize.toFixed()} ${quoteToken.symbol}`,
        },
        `Skipping pool, bigger than ${quoteMaxPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
        `Swap quote in amount: ${poolSize.toFixed()}`,
      );
      logger.info(`-------------------🤖🔧------------------- \n`);
      return;
    }
  }

  if (CHECK_IF_MINT_IS_RENOUNCED) {
    const mintOption = await checkMintable(poolState.baseMint);

    if (mintOption !== true) {
      logger.warn({ mint: poolState.baseMint }, 'Skipping, owner can mint tokens!');
      return;
    }
  }

  if (RUGPULL_CHECK) {
    const isSafeToBuy = getTokenMetadata(poolState.baseMint);
    if (!isSafeToBuy) {
      logger.warn({ mint: poolState.baseMint }, 'Skipping, token is not safe to buy. It might be a rugpull.');
      return;
    }
  }
  await buy(id, poolState);
}

export async function checkMintable(vault: PublicKey): Promise<boolean | undefined> {
  try {
    let { data } = (await solanaConnection.getAccountInfo(vault)) || {};
    if (!data) {
      return;
    }
    const deserialize = MintLayout.decode(data);
    return deserialize.mintAuthorityOption === 0;
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: vault }, `Failed to check if mint is renounced`);
  }
}

export async function processOpenBookMarket(updatedAccountInfo: KeyedAccountInfo) {
  let accountData: MarketStateV3 | undefined;
  try {
    accountData = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);

    // to be competitive, we collect market data before buying the token...
    if (existingTokenAccounts.has(accountData.baseMint.toString())) {
      return;
    }

    const tokenAccount = await getTokenAccount(accountData.baseMint, accountData);
    existingTokenAccounts.set(tokenAccount.mint.toString(), tokenAccount);
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData?.baseMint }, `Failed to process market`);
  }
}

async function buy(accountId: PublicKey, accountData: LiquidityStateV4): Promise<void> {
  try {
    const baseMint = accountData.baseMint.toString();
    // This will happen if we have already seen this token (if we either bought it, failed at buying it, or we have it in our wallet before running the program.)
    let tokenAccount = existingTokenAccounts.get(baseMint);

    if (!tokenAccount) {
      // it's possible that we didn't have time to fetch open book data
      const market = await getMinimalMarketV3(solanaConnection, accountData.marketId, COMMITMENT_LEVEL);
      // In method getTokenAccountAndPrice, we fetch the price of the token as well
      tokenAccount = await getTokenAccount(accountData.baseMint, market);
      existingTokenAccounts.set(baseMint, tokenAccount);
    }
    tokenAccount.poolKeys = createPoolKeys(accountId, accountData, tokenAccount.market!);
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: tokenAccount.poolKeys,
        userKeys: {
          tokenAccountIn: quoteTokenAssociatedAddress,
          tokenAccountOut: tokenAccount.address,
          owner: wallet.publicKey,
        },
        amountIn: quoteAmount.raw,
        minAmountOut: 0,
      },
      tokenAccount.poolKeys.version,
    );

    const latestBlockhash = await solanaConnection.getLatestBlockhash({
      commitment: COMMITMENT_LEVEL,
    });
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 421197 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 101337 }),
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          tokenAccount.address,
          wallet.publicKey,
          accountData.baseMint,
        ),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);
    const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: COMMITMENT_LEVEL,
    });
    logger.info({ mint: accountData.baseMint, signature }, `Sent buy tx`);
    processingToken = true;

    const confirmation = await solanaConnection.confirmTransaction(
      {
        signature,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        blockhash: latestBlockhash.blockhash,
      },
      COMMITMENT_LEVEL,
    );
    if (!confirmation.value.err) {
      logger.info(`-------------------🟢------------------- `);
      logger.info(
        {
          mint: accountData.baseMint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
        },
        `Confirmed buy tx`,
      );
      // amount bought is set after we've successfully bought the token
      const price = await fetchCoinPrice(baseMint);
      if (price) {
        // It's important to set the amount bought after we've successfully bought the token, since the buy command might fail
        const amount = quoteAmount.raw.toNumber() / price;
        existingTokenAccounts.set(accountData.baseMint.toString(), {
          ...tokenAccount,
          amount: new BN(amount),
          purchasePrice: price,
        });
      } else {
        logger.warn({ baseMint }, `Failed to fetch price for token while buying it.`);
      }
    } else {
      logger.debug(confirmation.value.err);
      logger.info({ mint: accountData.baseMint, signature }, `Error confirming buy tx`);
    }
  } catch (e) {
    logger.debug(e);
    processingToken = false;
    logger.error({ mint: accountData.baseMint }, `Failed to buy token`);
  }
}

async function sell(mint: PublicKey, amount: BigNumberish, tokenAccount: MinimalTokenAccountData): Promise<void> {
  let sold = false;
  let retries = 0;

  if (AUTO_SELL_DELAY > 0) {
    await new Promise((resolve) => setTimeout(resolve, AUTO_SELL_DELAY));
  }

  do {
    try {
      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: tokenAccount.poolKeys!,
          userKeys: {
            tokenAccountOut: quoteTokenAssociatedAddress,
            tokenAccountIn: tokenAccount.address,
            owner: wallet.publicKey,
          },
          amountIn: amount,
          minAmountOut: 0,
        },
        tokenAccount.poolKeys!.version,
      );

      const latestBlockhash = await solanaConnection.getLatestBlockhash({
        commitment: COMMITMENT_LEVEL,
      });
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 421197 }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 101337 }),
          ...innerTransaction.instructions,
          createCloseAccountInstruction(tokenAccount.address, wallet.publicKey, wallet.publicKey),
        ],
      }).compileToV0Message();
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);
      const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: COMMITMENT_LEVEL,
      });
      logger.info({ mint, signature }, `Sent sell tx`);
      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        COMMITMENT_LEVEL,
      );
      if (confirmation.value.err) {
        logger.debug(confirmation.value.err);
        logger.info({ mint, signature }, `Error confirming sell tx`);
        continue;
      }
      logger.info(`-------------------🔴------------------- `);
      logger.info(
        {
          dex: `https://dexscreener.com/solana/${mint}?maker=${wallet.publicKey}`,
          mint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
        },
        `Confirmed sell tx`,
      );
      sold = true;
      processingToken = false;
    } catch (e: any) {
      // wait for a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries++;
      logger.debug(e);
      logger.error({ mint }, `Failed to sell token, retry: ${retries}/${MAX_SELL_RETRIES}`);
    }
  } while (!sold && retries < MAX_SELL_RETRIES);
  processingToken = false;
}

const runListener = async () => {
  await init();
  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const raydiumSubscriptionId = solanaConnection.onProgramAccountChange(
    RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    async (updatedAccountInfo) => {
      const key = updatedAccountInfo.accountId.toString();
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
      const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
      const existing = existingLiquidityPools.has(key);

      if (poolOpenTime > runTimestamp && !existing) {
        existingLiquidityPools.add(key);
        const _ = processRaydiumPool(updatedAccountInfo.accountId, poolState);
      }
    },
    COMMITMENT_LEVEL,
    [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
          bytes: OPENBOOK_PROGRAM_ID.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
          bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
        },
      },
    ],
  );

  const openBookSubscriptionId = solanaConnection.onProgramAccountChange(
    OPENBOOK_PROGRAM_ID,
    async (updatedAccountInfo) => {
      const key = updatedAccountInfo.accountId.toString();
      const existing = existingOpenBookMarkets.has(key);
      if (!existing) {
        existingOpenBookMarkets.add(key);
        const _ = processOpenBookMarket(updatedAccountInfo);
      }
    },
    COMMITMENT_LEVEL,
    [
      { dataSize: MARKET_STATE_LAYOUT_V3.span },
      {
        memcmp: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
    ],
  );

  let sellAfterGainSubscription = null;
  if (SELL_AFTER_GAIN) {
    sellAfterGainSubscription = solanaConnection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo!.data);

        logger.info('Checking if we should sell token...');
        if (updatedAccountInfo.accountId.equals(quoteTokenAssociatedAddress)) {
          // We don't want to sell the quote token (WSOL or USDC)
          return;
        }
        const tokenAccount = existingTokenAccounts.get(accountData.mint.toString());
        // First, we want to check if we have detected the token before
        if (!tokenAccount) {
          logger.warn(`Token account not found for mint ${accountData.mint.toString()}`);
          return;
        }

        // Then we want to check if we have pool keys for the token
        if (!tokenAccount.poolKeys) {
          logger.warn({ mint: tokenAccount.mint }, 'No pool keys found');
          return;
        }

        // Then we want to check if we have registered a purchase price
        // We bought, but didn't register the price in case of API not being available
        if (!tokenAccount.purchasePrice) {
          logger.info(`Trying to sell token ${accountData.mint.toString()} but no purchase price found`);
          return;
        }

        // Then we want to check if we have a balance of the token
        if (Number(accountData.amount) === 0) {
          logger.info(
            {
              mint: tokenAccount.mint,
            },
            `Empty balance, can't sell`,
          );
          return;
        }

        // Lastly, we want to check the current price.
        // It's important that we check the price last, Since calling the API is expensive in terms of time and API rate limits.
        const currentPrice = await fetchCoinPrice(tokenAccount.mint.toString());
        if (!currentPrice) {
          logger.warn(
            `Failed to fetch current price for token ${accountData.mint.toString()}, or the price of token is 0.`,
          );
          return;
        }

        const profitShare = (currentPrice - tokenAccount.purchasePrice) / tokenAccount.purchasePrice;
        const profitPercentage = profitShare * 100;

        if (profitShare < SELL_AFTER_GAIN_PERCENTAGE) {
          logger.info(
            {
              mint: accountData.mint,
              profitPercentage,
            },
            `Profit of ${profitPercentage}%, not selling token at price of ${currentPrice}...`,
          );
          return;
        } else {
          logger.info(
            {
              mint: accountData.mint,
              profit_percentage: profitPercentage,
              soldAt: currentPrice,
            },
            `Reached the profit percentage of ${profitPercentage}% (surpassing the ${SELL_AFTER_GAIN_PERCENTAGE * 100}%), selling the token.`,
          );
          sell(accountData.mint, accountData.amount, tokenAccount);
          return;
        }
      },
      COMMITMENT_LEVEL,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ],
    );
    logger.info(
      `Listening for wallet changes and implementing sell after gain percentage strategy: ${sellAfterGainSubscription}`,
    );
  }

  let autoSellSubscription = null;
  if (AUTO_SELL) {
    autoSellSubscription = solanaConnection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo!.data);

        if (updatedAccountInfo.accountId.equals(quoteTokenAssociatedAddress)) {
          return;
        }

        const tokenAccount = existingTokenAccounts.get(accountData.mint.toString());
        // First, we want to check if we have detected the token before
        if (!tokenAccount) {
          logger.warn(`Token account not found for mint ${accountData.mint.toString()}`);
          return;
        }

        const _ = sell(accountData.mint, accountData.amount, tokenAccount);
      },
      COMMITMENT_LEVEL,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ],
    );

    logger.info(`Listening for wallet changes and implementing after sell subscription: ${autoSellSubscription}`);
  }

  logger.info(`Listening for Raydium changes: ${raydiumSubscriptionId}`);
  logger.info(`Listening for open book changes: ${openBookSubscriptionId}`);

  logger.info('------------------- 🚀 ---------------------');
  logger.info('Bot is running! Press CTRL + C to stop it.');
  logger.info('------------------- 🚀 ---------------------');
};

runListener();
