// Create type that output of https://docs.dexscreener.com/api/reference#get-one-or-multiple-pairs-by-token-address
// API call will match

type Token = {
  address: string;
  name: string;
  symbol: string;
};

type TransactionVolumes = {
  buys: number;
  sells: number;
};

type PriceChange = {
  m5: number;
  h1: number;
  h6: number;
  h24: number;
};

type Volume = {
  h24: number;
  h6: number;
  h1: number;
  m5: number;
};

type Liquidity = {
  usd: number;
  base: number;
  quote: number;
};

type Pair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: Token;
  quoteToken: Token;
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: TransactionVolumes;
    h1: TransactionVolumes;
    h6: TransactionVolumes;
    h24: TransactionVolumes;
  };
  volume: Volume;
  priceChange: PriceChange;
  liquidity: Liquidity;
  fdv: number;
  pairCreatedAt: number;
};

export type DexScreenerListedTokensApi = {
  schemaVersion: string;
  pairs: Pair[];
};
