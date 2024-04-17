import { Commitment } from '@solana/web3.js';
import { logger, retrieveEnvVariable } from '../utils';

const possibleCommitments = ['processed', 'confirmed', 'finalized'];

export const NETWORK = 'mainnet-beta';
export const COMMITMENT_LEVEL: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
if (!possibleCommitments.includes(COMMITMENT_LEVEL)) {
  logger.error({ COMMITMENT_LEVEL }, `Invalid commitment level. Possible values are ${possibleCommitments.join(', ')}`);
  process.exit(1);
}
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);
export const LOG_LEVEL = retrieveEnvVariable('LOG_LEVEL', logger);
export const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true';
export const MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger));
export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);
export const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
export const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
export const MIN_POOL_SIZE = retrieveEnvVariable('MIN_POOL_SIZE', logger);
export const MAX_POOL_SIZE = retrieveEnvVariable('MAX_POOL_SIZE', logger);
export const ONE_TOKEN_AT_A_TIME = retrieveEnvVariable('ONE_TOKEN_AT_A_TIME', logger) === 'true';
export const SELL_AFTER_GAIN_PERCENTAGE = parseFloat(retrieveEnvVariable('SELL_AFTER_GAIN_PERCENTAGE', logger));
export const SELL_AFTER_GAIN = retrieveEnvVariable('SELL_AFTER_GAIN', logger) === 'true';
export const AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger) === 'true';
export const AUTO_SELL_DELAY = parseFloat(retrieveEnvVariable('AUTO_SELL_DELAY', logger));
export const RUGPULL_CHECK = retrieveEnvVariable('RUGPULL_CHECK', logger) === 'true';

if (AUTO_SELL && SELL_AFTER_GAIN) {
  logger.error('AUTO_SELL and SELL_AFTER_GAIN strategies cannot be used together. You get to choose one at most.');
  process.exit(1);
}
