import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils';

const METADATA_PUBKEY = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

interface Creator {
  address: PublicKey;
  verified: boolean;
  share: number;
}

interface Metadata {
  updateAuthority: PublicKey;
  mint: PublicKey;
  data: {
    name: string;
    symbol: string;
    uri: string;
    sellerFeeBasisPoints: number;
    creators: Creator[];
  };
  primarySaleHappened: boolean;
  isMutable: boolean;
}

function decodeMetadata(metadataBuffer: Buffer): Metadata {
  let offset = 0;

  // Ensure the metadata format version is correct (version byte should be 4)
  if (metadataBuffer[offset] !== 4) {
    throw new Error('Unsupported metadata version');
  }
  offset += 1;

  const updateAuthority = new PublicKey(metadataBuffer.slice(offset, offset + 32));
  offset += 32;

  const mint = new PublicKey(metadataBuffer.slice(offset, offset + 32));
  offset += 32;

  const nameLength = metadataBuffer.readUInt32LE(offset);
  offset += 4;
  const name = metadataBuffer
    .slice(offset, offset + nameLength)
    .toString('utf-8')
    .replace(/\0/g, '');
  offset += nameLength;

  const symbolLength = metadataBuffer.readUInt32LE(offset);
  offset += 4;
  const symbol = metadataBuffer
    .slice(offset, offset + symbolLength)
    .toString('utf-8')
    .replace(/\0/g, '');
  offset += symbolLength;

  const uriLength = metadataBuffer.readUInt32LE(offset);
  offset += 4;
  const uri = metadataBuffer
    .slice(offset, offset + uriLength)
    .toString('utf-8')
    .replace(/\0/g, '');
  offset += uriLength;

  const sellerFeeBasisPoints = metadataBuffer.readInt16LE(offset);
  offset += 2;

  const hasCreator = metadataBuffer[offset];
  offset += 1;

  const creators: Creator[] = [];
  if (hasCreator) {
    const creatorCount = metadataBuffer.readUInt32LE(offset);
    offset += 4;
    for (let i = 0; i < creatorCount; i++) {
      const address = new PublicKey(metadataBuffer.slice(offset, offset + 32));
      offset += 32;
      const verified = metadataBuffer[offset] === 1;
      offset += 1;
      const share = metadataBuffer[offset];
      offset += 1;
      creators.push({ address, verified, share });
    }
  }

  const primarySaleHappened = metadataBuffer[offset] === 1;
  offset += 1;

  const isMutable = metadataBuffer[offset] === 1;

  return {
    updateAuthority,
    mint,
    data: {
      name,
      symbol,
      uri,
      sellerFeeBasisPoints,
      creators,
    },
    primarySaleHappened,
    isMutable,
  };
}

const get_metadataPda = async (address: PublicKey) => {
  let [pda, bump] = await PublicKey.findProgramAddress(
    [Buffer.from('metadata'), METADATA_PUBKEY.toBuffer(), address.toBuffer()],
    METADATA_PUBKEY,
  );
  return pda;
};

export async function getTokenMetadata(token_address: any) {
  try {
    const token_publickey = new PublicKey(token_address);
    const metadata_pda = await get_metadataPda(token_publickey);

    const data = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [
        metadata_pda.toBase58(),
        {
          encoding: 'base64',
        },
      ],
    };
    const metadata_res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    const metadata_parsed = await metadata_res.json();
    const metadata_buf = Buffer.from(metadata_parsed.result.value.data[0], 'base64');

    const metadata = decodeMetadata(metadata_buf);

    const arweave_res = await fetch(metadata.data.uri);
    const arweave = await arweave_res.json();

    if (
      Number(metadata.isMutable) === 1 ||
      !arweave?.description ||
      !arweave?.extensions?.twitter ||
      (arweave?.extensions?.twitter).includes('status') ||
      (arweave?.extensions?.twitter).includes('MkDolansSol') ||
      !(arweave?.extensions?.twitter).includes('twitter')
    ) {
      return false;
    } else {
      return true;
    }
  } catch (e) {
    logger.error(e);
    return false;
  }
}
