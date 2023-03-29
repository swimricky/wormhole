import {
    Ed25519Keypair,
    JsonRpcProvider,
    RawSigner,
    TransactionBlock,
    Connection
} from '@mysten/sui.js';

// Generate a new Ed25519 Keypair
const provider = new JsonRpcProvider(new Connection({ fullnode: "http://0.0.0.0:9000" }))

const getSigner = (): RawSigner => {
  //let privateKey = "AARb87p4OlmRjUBCZOBy8iLGTWt1PVZ6gowPx7Lit+Tn"; // 0x42ee1baa8f38d0a4d9ba84bfedecbc876bdc6ae7c58833fc5f7548adf5058636
  //let privateKey = "AHt/Q9fIm5/a4yaGp9qqQPrNuy+xTntn/DrcN8X16LZe"; // 0x41ebfbbf39dbc5a281839d5778e01025138dd133095d66221de5b0e31416aa76
  let privateKey = "AGaHKxUbTCiITbHGDOxpsNmKVUfHgflH7OIoYagYYLqa"; //0x9f79d84367a618ec4b08e18a2d0e00e84d2803dcf3666a41980e5ffbc8fa2f19

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
  const [w] = tx.moveCall({ target: "0x86b0543315f0ad563cada2eeee2d702528794e4972bd0f22b8c68c6526fe1c75::programmable::produce_A" });
  const result = await signer.signAndExecuteTransactionBlock({ transactionBlock: tx,  });
  console.log(result);
  console.log(w)
}

async function moveVec(){
  const signer = getSigner();
  const tx = new TransactionBlock();
  tx.setGasBudget(20000);
  const [w] = tx.moveCall({ target: "0x86b0543315f0ad563cada2eeee2d702528794e4972bd0f22b8c68c6526fe1c75::programmable::produce_A" });
  const result = await signer.signAndExecuteTransactionBlock({ transactionBlock: tx,  });
  console.log(result);
  console.log(w)
}

await moveCall();

// const tx = new TransactionBlock();

// function setup() {
//     const tx = new TransactionBlock();
//     tx.setSender('0x2');
//     tx.setGasPrice(5);
//     tx.setGasBudget(100);
//     tx.setGasPayment([ref()]);
//     return tx;
//   }