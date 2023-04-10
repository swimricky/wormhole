import { expect } from "chai";

import {
  WALLET_PRIVATE_KEY,
  WORMHOLE_PACKAGE_ID,
  WORMHOLE_STATE_ID,
} from "./helpers/consts";
import {
  Ed25519Keypair,
  JsonRpcProvider,
  localnetConnection,
  RawSigner,
  SUI_CLOCK_OBJECT_ID,
  TransactionBlock,
} from "@mysten/sui.js";

describe(" 1. Wormhole", () => {
  const provider = new JsonRpcProvider(localnetConnection);

  // User wallet.
  const wallet = new RawSigner(
    Ed25519Keypair.fromSecretKey(WALLET_PRIVATE_KEY),
    provider
  );

  describe("Publish Message", () => {
    it("Check `WormholeMessage` Event", async () => {
      const owner = await wallet.getAddress();

      // Create emitter cap.
      const emitterCapId = await (async () => {
        const tx = new TransactionBlock();
        const [emitterCap] = tx.moveCall({
          target: `${WORMHOLE_PACKAGE_ID}::emitter::new`,
          arguments: [tx.object(WORMHOLE_STATE_ID)],
        });
        tx.transferObjects([emitterCap], tx.pure(owner));

        // Execute and fetch created Emitter cap.
        return wallet
          .signAndExecuteTransactionBlock({
            transactionBlock: tx,
            options: {
              showObjectChanges: true,
            },
          })
          .then((result) => {
            let found = result.objectChanges?.filter(
              (item) => "type" in item && "created" === item.type
            );
            if (found?.length == 1 && "objectId" in found[0]) {
              return found[0].objectId;
            }

            throw new Error("no objects found");
          });
      })();

      // Publish messages using emitter cap.
      {
        const nonce = 69;
        const basePayload = "All your base are belong to us.";

        // Save timestamp from last event.
        let lastTimestamp = 0n;

        // Construct transaction block.
        for (let i = 0; i < 8; ++i) {
          // Make a unique message.
          const payload = basePayload + `... ${i}`;

          const tx = new TransactionBlock();
          const [wormholeFee] = tx.splitCoins(tx.gas, [tx.pure(0)]);
          tx.moveCall({
            target: `${WORMHOLE_PACKAGE_ID}::publish_message::publish_message`,
            arguments: [
              tx.object(WORMHOLE_STATE_ID),
              tx.object(emitterCapId),
              tx.pure(nonce),
              tx.pure(payload),
              wormholeFee,
              tx.object(SUI_CLOCK_OBJECT_ID),
            ],
          });

          // Execution cost ~57k
          tx.setGasBudget(60_000);
          const eventData = await wallet
            .signAndExecuteTransactionBlock({
              transactionBlock: tx,
              options: {
                showEvents: true,
              },
            })
            .then((result) => {
              if ("events" in result && result.events?.length == 1) {
                return result.events[0];
              }

              throw new Error("event not found");
            })
            .then((event) => event.parsedJson!);
          expect(eventData.consistency_level).equals(0);
          expect(eventData.nonce).equals(nonce);
          expect(eventData.payload).deep.equals([...Buffer.from(payload)]);
          expect(eventData.sender).equals(emitterCapId);
          expect(eventData.sequence).equals(i.toString());

          let timestamp = BigInt(eventData?.timestamp);
          expect(timestamp >= lastTimestamp).is.true;
          timestamp = lastTimestamp;
        }
      }
    });
  });
});
