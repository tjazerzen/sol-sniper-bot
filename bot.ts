import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  CurrencyAmount,
  Liquidity,
  LiquidityPoolKeysV4,
  LiquidityStateV4,
  Percent,
  Token,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { ProfitTransferExecutor } from './transactions/profit-transaction-executor';
import axios from 'axios';
import { RugcheckXyzReport } from './bot.types';

type PriceMatchResponse =
  | {
      action: 'sell';
      reason: 'stopLoss';
      amountOut: TokenAmount | CurrencyAmount;
    }
  | {
      action: 'no-sell';
    }
  | {
      action: 'sell';
      reason: 'takeProfit';
      profit: CurrencyAmount;
      amountOut: TokenAmount | CurrencyAmount;
    };

export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  checkBurned: boolean;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  autoSell: boolean;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  setCustomTips: boolean;
  unitLimit: number;
  unitPrice: number;
  takeProfit: boolean;
  takeProfit1AfterGain: number;
  takeProfit1Percentage: number;
  takeProfit2AfterGain: number;
  takeProfit2Percentage: number;
  takeProfitFeePercentage: number;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  rugcheckXyzCheck: boolean;
  rugcheckXyzMaxScore: number;
}

// Set of those mint addresses that have been sold after gain 1 (takeProfit1After gain)
const soldAfterGain1 = new Set<string>();

// Set of those mint addresses that have been sold after gain 2 (takeProfit2After gain)
const soldAfterGain2 = new Set<string>();

export class Bot {
  private readonly poolFilters: PoolFilters;

  // one token at the time
  private readonly mutex: Mutex;
  private sellExecutionCount = 0;
  public readonly isProfitExecutor: boolean = false;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {
    this.isProfitExecutor = txExecutor instanceof ProfitTransferExecutor;

    this.mutex = new Mutex();
    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });
  }

  async validate() {
    try {
      await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      return false;
    }

    return true;
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked() || this.sellExecutionCount > 0) {
        logger.debug(
          { mint: poolState.baseMint.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return;
      }

      await this.mutex.acquire();
    }

    let rugcheckScore: number = -1;
    if (this.config.rugcheckXyzCheck) {
      try {
        const axiosReponse = await axios.get(
          `https://api.rugcheck.xyz/v1/tokens/${poolState.baseMint.toString()}/report`,
        );
        const rugcheckReport: RugcheckXyzReport = axiosReponse.data;
        rugcheckScore = rugcheckReport.score;
        if (rugcheckScore > this.config.rugcheckXyzMaxScore) {
          logger.trace(
            { mint: poolState.baseMint.toString(), rugcheckScore },
            `Skipping buy because token has a high rugcheck.xyz score`,
          );
          return;
        }
      } catch (error) {
        logger.info(
          { mint: poolState.baseMint.toString() },
          `Error fetching rugcheck.xyz report. Ignoring rugcheck threshold score check.`,
        );
      }
    }

    logger.trace({ mint: poolState.baseMint.toString(), rugcheckScore }, `Rugcheck score is ok. Continuing...`);

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      const match = await this.filterMatch(poolKeys);

      if (!match) {
        logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
        return;
      }

      logger.info({ mint: poolState.baseMint.toString() }, `Processing buy...`);

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          if (result.confirmed) {
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed buy tx`,
            );

            break;
          }

          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount) {
    const accountMintAddress = rawAccount.mint.toString();

    if (soldAfterGain1.has(accountMintAddress) && soldAfterGain2.has(accountMintAddress)) {
      logger.debug({ mint: accountMintAddress }, `Skipping sell because token was sold after gain twice`);
    }

    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    let desiredGain: number;
    let sellingRound: 'first' | 'second';
    if (soldAfterGain1.has(accountMintAddress)) {
      desiredGain = this.config.takeProfit2AfterGain;
      sellingRound = 'second';
    } else {
      desiredGain = this.config.takeProfit1AfterGain;
      sellingRound = 'first';
    }

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

      const poolData = await this.poolStorage.get(accountMintAddress);

      if (!poolData) {
        logger.trace({ mint: accountMintAddress }, `Token pool data is not found, can't sell`);
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenInPercentage =
        sellingRound == 'first' ? this.config.takeProfit1Percentage : this.config.takeProfit2Percentage;
      const tokenInAmount = (BigInt(tokenInPercentage) * rawAccount.amount) / BigInt(100);
      const tokenAmountIn = new TokenAmount(tokenIn, tokenInAmount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: accountMintAddress }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      const priceMatchResponse = await this.priceMatch(tokenAmountIn, poolKeys, desiredGain);
      if (priceMatchResponse.action == 'sell') {
        logger.info({ mint: accountMintAddress, priceMatchResponse }, `Matched the price, executing sale...`);
        let fee: undefined | CurrencyAmount = undefined;
        if (priceMatchResponse.reason == 'takeProfit' && this.isProfitExecutor) {
          logger.debug({ mint: accountMintAddress }, `Calculating fee for take profit`);
          const profit = priceMatchResponse.profit;
          const feeFraction = profit.mul(this.config.takeProfitFeePercentage).numerator.div(new BN(100));
          fee = new CurrencyAmount(profit.currency, feeFraction, true);
        }
        for (let i = 0; i < this.config.maxSellRetries; i++) {
          try {
            logger.info(
              { mint: rawAccount.mint },
              `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
            );

            const result = await this.swap(
              poolKeys,
              accountId,
              this.config.quoteAta,
              tokenIn,
              this.config.quoteToken,
              tokenAmountIn,
              this.config.sellSlippage,
              this.config.wallet,
              'sell',
              fee,
            );

            if (result.confirmed) {
              logger.info(
                {
                  dex: `https://dexscreener.com/solana/${accountMintAddress}?maker=${this.config.wallet.publicKey}`,
                  mint: accountMintAddress,
                  signature: result.signature,
                  url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
                },
                `Confirmed sell tx`,
              );
              if (sellingRound == 'first') {
                soldAfterGain1.add(accountMintAddress);
              } else {
                soldAfterGain2.add(accountMintAddress);
              }
              break;
            }

            logger.info(
              {
                mint: accountMintAddress,
                signature: result.signature,
                error: result.error,
              },
              `Error confirming sell tx`,
            );
          } catch (error) {
            logger.debug({ mint: accountMintAddress, error }, `Error confirming sell transaction`);
          }
        }
      } else {
        logger.info({ mint: accountMintAddress, priceMatchResponse }, `Price doesn't match, skipping sell...`);
      }
    } catch (error) {
      logger.error({ mint: accountMintAddress, error }, `Failed to sell token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
    fee?: CurrencyAmount,
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.config.setCustomTips
          ? [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]
          : []),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)]),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    if (fee) {
      return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash, fee);
    } else {
      return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
    }
  }

  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    return await this.poolFilters.execute(poolKeys);
  }

  private async priceMatch(
    amountIn: TokenAmount,
    poolKeys: LiquidityPoolKeysV4,
    profitGainPercentage: number,
  ): Promise<PriceMatchResponse> {
    const profitFraction = this.config.quoteAmount.mul(profitGainPercentage).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);
    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);
    try {
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys,
      });
      const amountOut = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn: amountIn,
        currencyOut: this.config.quoteToken,
        slippage,
      }).amountOut;
      logger.debug(
        { mint: poolKeys.baseMint.toString() },
        `Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
      );
      if (amountOut.lt(stopLoss) && this.config.stopLoss > 0) {
        return { action: 'sell', reason: 'stopLoss', amountOut };
      }
      if (amountOut.gt(takeProfit) && this.config.takeProfit) {
        // Calculate the profit amount
        const profit = amountOut.sub(this.config.quoteAmount);
        // const tokenAmount =
        return { action: 'sell', reason: 'takeProfit', profit, amountOut };
      }
    } catch (e) {
      logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
    }
    return { action: 'no-sell' };
  }
}
