import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import {
  Liquidity,
  LiquidityPoolKeys,
  Market,
  TokenAccount,
  SPL_ACCOUNT_LAYOUT,
  publicKey,
  struct,
  MAINNET_PROGRAM_ID,
  LiquidityStateV4,
} from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { MinimalMarketLayoutV3 } from '../market';
import BN from 'bn.js';
import { logger } from '../utils';
import { QUOTE_MINT } from '../constants';
import { DexScreenerListedTokensApi } from './liquidity-types';

export type TokenAccountWithAmountAndPrice = TokenAccount & { amount: BN; price: number | undefined };

const SOLANA_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112';

export const RAYDIUM_LIQUIDITY_PROGRAM_ID_V4 = MAINNET_PROGRAM_ID.AmmV4;
export const OPENBOOK_PROGRAM_ID = MAINNET_PROGRAM_ID.OPENBOOK_MARKET;

const QUOTE_MINT_TO_DEXSCREENER_SYMBOL: { [key: string]: string } = {
  WSOL: 'SOL',
  USDC: 'USDC',
};

export const MINIMAL_MARKET_STATE_LAYOUT_V3 = struct([publicKey('eventQueue'), publicKey('bids'), publicKey('asks')]);

export function createPoolKeys(
  id: PublicKey,
  accountData: LiquidityStateV4,
  minimalMarketLayoutV3: MinimalMarketLayoutV3,
): LiquidityPoolKeys {
  return {
    id,
    baseMint: accountData.baseMint,
    quoteMint: accountData.quoteMint,
    lpMint: accountData.lpMint,
    baseDecimals: accountData.baseDecimal.toNumber(),
    quoteDecimals: accountData.quoteDecimal.toNumber(),
    lpDecimals: 5,
    version: 4,
    programId: RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    authority: Liquidity.getAssociatedAuthority({
      programId: RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    }).publicKey,
    openOrders: accountData.openOrders,
    targetOrders: accountData.targetOrders,
    baseVault: accountData.baseVault,
    quoteVault: accountData.quoteVault,
    marketVersion: 3,
    marketProgramId: accountData.marketProgramId,
    marketId: accountData.marketId,
    marketAuthority: Market.getAssociatedAuthority({
      programId: accountData.marketProgramId,
      marketId: accountData.marketId,
    }).publicKey,
    marketBaseVault: accountData.baseVault,
    marketQuoteVault: accountData.quoteVault,
    marketBids: minimalMarketLayoutV3.bids,
    marketAsks: minimalMarketLayoutV3.asks,
    marketEventQueue: minimalMarketLayoutV3.eventQueue,
    withdrawQueue: accountData.withdrawQueue,
    lpVault: accountData.lpVault,
    lookupTableAccount: PublicKey.default,
  };
}

export async function getTokenAccounts(
  connection: Connection,
  owner: PublicKey,
  commitment?: Commitment,
): Promise<TokenAccountWithAmountAndPrice[]> {
  const tokenResp = await connection.getTokenAccountsByOwner(
    owner,
    {
      programId: TOKEN_PROGRAM_ID,
    },
    commitment,
  );

  const accounts: TokenAccountWithAmountAndPrice[] = [];
  for (const { pubkey, account } of tokenResp.value) {
    const accountInfo = SPL_ACCOUNT_LAYOUT.decode(account.data);
    const coinPrice = await fetchCoinPrice(accountInfo.mint.toBase58());
    accounts.push({
      pubkey,
      programId: account.owner,
      accountInfo,
      price: coinPrice,
      // Add the token amount to the account object
      amount: accountInfo.amount,
    });
  }

  return accounts;
}

export async function fetchCoinPrice(mintAddress: string): Promise<number | undefined> {
  // https://docs.dexscreener.com/api/reference#get-one-or-multiple-pairs-by-token-address
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`;

    const response = await fetch(url);
    const ApiReturnObject: DexScreenerListedTokensApi = await response.json();

    if (ApiReturnObject.pairs === null || ApiReturnObject.pairs.length === 0) {
      logger.warn({ mintAddress }, 'No trade pairs found for mint address.');
      return undefined;
    }

    if (mintAddress === SOLANA_TOKEN_ADDRESS) {
      switch (QUOTE_MINT) {
        case 'USDC':
          return parseFloat(ApiReturnObject.pairs[0].priceUsd);
        case 'WSOL':
          // SOL denominated in SOL is 1
          return 1;
        default:
          logger.warn({ mintAddress }, 'Environment variable is not set to USDC or WSOL. Returning undefined.');
          return undefined;
      }
    }

    const dexScreenerSymbol = QUOTE_MINT_TO_DEXSCREENER_SYMBOL[QUOTE_MINT];

    const pair = ApiReturnObject.pairs.find((pair) => pair.quoteToken.symbol === dexScreenerSymbol);
    if (!pair) {
      logger.warn(
        { mintAddress, quoteMint: QUOTE_MINT, dexScreenerSymbol },
        'No trade pair found for mint address and quote mint.',
      );
      return undefined;
    }
    let price: number;
    if (QUOTE_MINT === 'USDC') {
      price = parseFloat(pair.priceUsd);
    } else if (QUOTE_MINT === 'WSOL') {
      price = parseFloat(pair.priceNative);
    } else {
      logger.warn({ mintAddress }, 'Environment variable is not set to USDC or WSOL. Returning undefined.');
      return undefined;
    }
    logger.info({ mintAddress, price }, 'Fetched coin price.');
    return price;
  } catch (e) {
    logger.warn({ mintAddress, error: e }, 'Failed to fetch coin price. Returning undefined.');
    return undefined;
  }
}
