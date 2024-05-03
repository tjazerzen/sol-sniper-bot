type Token = {
  mintAuthority: string;
  supply: number;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority?: any; // optional and uncertain type
};

type TokenMeta = {
  name: string;
  symbol: string;
  uri: string;
  mutable: boolean;
  updateAuthority: string;
};

type Holder = {
  address: string;
  amount: number;
  decimals: number;
  pct: number;
  uiAmount: number;
  uiAmountString: string;
  owner: string;
};

type Risk = {
  name: string;
  value: string;
  description: string;
  score: number;
  level: string;
};

type FileMeta = {
  description: string;
  name: string;
  symbol: string;
  image: string;
};

type TransferFee = {
  pct: number;
  maxAmount: number;
  authority: string;
};

type Market = {
  pubkey: string;
  marketType: string;
  mintA: string;
  mintB: string;
  mintLP: string;
  liquidityA: string;
  liquidityB: string;
  mintAAccount?: Token; // Optional because it's not in all objects
  mintBAccount?: Token; // Optional because it's not in all objects
  mintLPAccount?: Token; // Optional because it's not in all objects
  liquidityAAccount?: any; // Optional because it's not in all objects
  liquidityBAccount?: any; // Optional because it's not in all objects
  lp?: any; // Optional because it's not in all objects
};

export type RugcheckXyzReport = {
  mint: string;
  tokenProgram: string;
  token: Token | null;
  token_extensions: any | null;
  tokenMeta: TokenMeta | null;
  topHolders: Holder[] | null;
  freezeAuthority: any | null;
  mintAuthority: any | null;
  risks: Risk[] | null;
  score: number;
  fileMeta: FileMeta | null;
  lockerOwners: any | null;
  lockers: any | null;
  lpLockers: any | null;
  markets: Market[] | null;
  rugged: boolean;
  tokenType: string;
  transferFee: TransferFee;
  knownAccounts: any | null;
};
