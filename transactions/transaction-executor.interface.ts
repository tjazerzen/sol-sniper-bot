import { CurrencyAmount } from '@raydium-io/raydium-sdk';
import { BlockhashWithExpiryBlockHeight, Keypair, VersionedTransaction } from '@solana/web3.js';

export interface TransactionExecutor {
  executeAndConfirm(
    transaction: VersionedTransaction,
    payer: Keypair,
    latestBlockHash: BlockhashWithExpiryBlockHeight,
    fee?: CurrencyAmount,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string }>;
}
