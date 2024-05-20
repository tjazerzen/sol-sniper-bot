import { Logger } from 'pino';
import dotenv from 'dotenv';
import { Commitment } from '@solana/web3.js';
import { logger } from './logger';

dotenv.config();

const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.error(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

// Wallet
export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);

// Connection
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);
export const COMMITMENT_LEVEL: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
export const NETWORK = 'mainnet-beta';

// Bot
export const LOG_LEVEL = retrieveEnvVariable('LOG_LEVEL', logger);
export const ONE_TOKEN_AT_A_TIME = retrieveEnvVariable('ONE_TOKEN_AT_A_TIME', logger) === 'true';
export const PRE_LOAD_EXISTING_MARKETS = retrieveEnvVariable('PRE_LOAD_EXISTING_MARKETS', logger) === 'true';
export const CACHE_NEW_MARKETS = retrieveEnvVariable('CACHE_NEW_MARKETS', logger) === 'true';
export const TRANSFER_AFTER_PROFIT = retrieveEnvVariable('TRANSFER_AFTER_PROFIT', logger) == 'true';

// Fees
// try {
//   export const COMPUTE_UNIT_LIMIT = Number(retrieveEnvVariable('COMPUTE_UNIT_LIMIT', logger));

// }
// if (COMPUTE_UNIT_LIMIT === 0) {

let COMPUTE_UNIT_LIMIT: number;
if (process.env['COMPUTE_UNIT_LIMIT'] || '') {
  COMPUTE_UNIT_LIMIT = Number(retrieveEnvVariable('COMPUTE_UNIT_LIMIT', logger));
} else {
  COMPUTE_UNIT_LIMIT = 100000; // 10e5
}

let COMPUTE_UNIT_PRICE: number;
if (process.env['COMPUTE_UNIT_PRICE'] || '') {
  COMPUTE_UNIT_PRICE = Number(retrieveEnvVariable('COMPUTE_UNIT_PRICE', logger));
} else {
  // approx 0.01 USD
  // lamport
  // A fractional native token with the value of 0.000000001 sol.
  // 1 lamport = 10e6 microlamports
  COMPUTE_UNIT_PRICE = 100000000000; // 10e11
}

export { COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE };

// Buy
export const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
export const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
export const MAX_BUY_RETRIES = Number(retrieveEnvVariable('MAX_BUY_RETRIES', logger));
export const BUY_SLIPPAGE = Number(retrieveEnvVariable('BUY_SLIPPAGE', logger));

// Sell

// General sell parameters
export const MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger));
export const STOP_LOSS = Number(retrieveEnvVariable('STOP_LOSS', logger));
export const SELL_SLIPPAGE = Number(retrieveEnvVariable('SELL_SLIPPAGE', logger));
export const TAKE_PROFIT_FEE_PERCENTAGE = Number(retrieveEnvVariable('TAKE_PROFIT_FEE_PERCENTAGE', logger));

// Auto sell parameters
export const AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger) === 'true';
export const AUTO_SELL_DELAY = Number(retrieveEnvVariable('AUTO_SELL_DELAY', logger));

// Take profit parameters
export const TAKE_PROFIT = retrieveEnvVariable('TAKE_PROFIT', logger) === 'true';
export const TAKE_PROFIT_1_AFTER_GAIN = Number(retrieveEnvVariable('TAKE_PROFIT_1_AFTER_GAIN', logger));
export const TAKE_PROFIT_1_PERCENTAGE = Number(retrieveEnvVariable('TAKE_PROFIT_1_PERCENTAGE', logger));
export const TAKE_PROFIT_2_AFTER_GAIN = Number(retrieveEnvVariable('TAKE_PROFIT_2_AFTER_GAIN', logger));
export const TAKE_PROFIT_2_PERCENTAGE = Number(retrieveEnvVariable('TAKE_PROFIT_2_PERCENTAGE', logger));
export const TAKE_PROFIT_TRANSFER_WALLET_PUBLIC_ADDRESS = retrieveEnvVariable(
  'TAKE_PROFIT_TRANSFER_WALLET_PUBLIC_ADDRESS',
  logger,
);

// Filters
export const CHECK_IF_MUTABLE = retrieveEnvVariable('CHECK_IF_MUTABLE', logger) === 'true';
export const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true';
export const CHECK_IF_FREEZABLE = retrieveEnvVariable('CHECK_IF_FREEZABLE', logger) === 'true';
export const CHECK_IF_BURNED = retrieveEnvVariable('CHECK_IF_BURNED', logger) === 'true';
export const MIN_POOL_SIZE = retrieveEnvVariable('MIN_POOL_SIZE', logger);
export const MAX_POOL_SIZE = retrieveEnvVariable('MAX_POOL_SIZE', logger);

// Rugcheck
export const RUGCHECK_XYZ_CHECK = retrieveEnvVariable('RUGCHECK_XYZ_CHECK', logger) === 'true';
export const RUGCHECK_XYZ_MAX_SCORE = Number(retrieveEnvVariable('RUGCHECK_XYZ_MAX_SCORE', logger));
