import {
    Ed25519Keypair,
    JsonRpcProvider,
    RawSigner,
    TransactionBlock,
    Connection
} from '@mysten/sui.js';

// Generate a new Ed25519 Keypair
const provider = new JsonRpcProvider(new Connection({ fullnode: "http://0.0.0.0:9000" }))

// Put your own private key in here.
const getSigner = (): RawSigner => {
  let privateKey = "AGaHKxUbTCiITbHGDOxpsNmKVUfHgflH7OIoYagYYLqa"; //public key: 0x9f79d84367a618ec4b08e18a2d0e00e84d2803dcf3666a41980e5ffbc8fa2f19

  const bytes = new Uint8Array(Buffer.from(privateKey, "base64")); //
  const keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  console.log("pubkey: ", keypair.getPublicKey().toSuiAddress());
  return new RawSigner(keypair, provider);
};

async function splitCoinsAndSend(){
  const signer = getSigner();
  const tx = new TransactionBlock();
  // Split a coin object off of the gas object:
  const [coin] = tx.splitCoins(tx.gas, [tx.pure(100)]);
  // Transfer the resulting coin object:
  tx.transferObjects([coin], tx.pure("0x756c559cb861c20dbe9d20595a400283feffd7c88c78cf34ec075d227e66e3a2"));

  const result = await signer.signAndExecuteTransactionBlock({ transactionBlock: tx });
  console.log({ result });
}

async function moveCall(){
  const signer = getSigner();
  const tx = new TransactionBlock();
  tx.setGasBudget(20000);
  const [w] = tx.moveCall({ target: "0x58cb33db34c9e0de1767d9eb2f547684f38260ed454f3c4a67073e431576496f::programmable::produce_A" });
  const result = await signer.signAndExecuteTransactionBlock({ transactionBlock: tx,  });
  console.log(result);
  console.log(w)
}

async function chainMoveCalls(){
  const signer = getSigner();
  const tx = new TransactionBlock();
  tx.setGasBudget(20000);
  // produce_A takes nothing as input and produces an object of type A
  const [A] = tx.moveCall({ target: "0x58cb33db34c9e0de1767d9eb2f547684f38260ed454f3c4a67073e431576496f::programmable::produce_A" });
  // produce_B takes an object of type A as input and produces an object of type B as output
  const [B] = tx.moveCall({ target: "0x58cb33db34c9e0de1767d9eb2f547684f38260ed454f3c4a67073e431576496f::programmable::produce_B", arguments: [A] });
  console.log(B);
  const result = await signer.signAndExecuteTransactionBlock({ transactionBlock: tx,  });
  console.log(result);
}

await chainMoveCalls();
