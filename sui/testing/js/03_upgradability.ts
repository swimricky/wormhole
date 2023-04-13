import { expect } from "chai";
import fs from "fs";
import { resolve } from "path";
import * as mock from "@certusone/wormhole-sdk/lib/cjs/mock";
import {
  Ed25519Keypair,
  JsonRpcProvider,
  localnetConnection,
  RawSigner,
  SUI_CLOCK_OBJECT_ID,
  TransactionBlock,
} from "@mysten/sui.js";

import { buildForDigest } from "./helpers/build";
import {
  GOVERNANCE_EMITTER,
  WALLET_PRIVATE_KEY,
  WORMHOLE_STATE_ID,
} from "./helpers/consts";
import { generateVaaFromDigest } from "./helpers/setup";
import { buildAndUpgradeWormhole } from "./helpers/upgrade";
import { getPackageId } from "./helpers/utils";

describe(" 3. Upgradability", () => {
  const provider = new JsonRpcProvider(localnetConnection);

  // User wallet.
  const wallet = new RawSigner(
    Ed25519Keypair.fromSecretKey(WALLET_PRIVATE_KEY),
    provider
  );

  // Governance
  const governance = new mock.GovernanceEmitter(GOVERNANCE_EMITTER);

  // This directory is used to set up builds.
  const dstWormholePath = resolve(`${__dirname}/../wormhole`);

  // Persisting variables across tests.
  const localVariables: Map<string, any> = new Map();

  beforeEach(() => {
    // Move contract directory to testing and prepare it for build.
    const srcWormholePath = `${__dirname}/../../wormhole`;
    fs.cpSync(srcWormholePath, dstWormholePath, { recursive: true });

    // Remove irrelevant files. This part is not necessary, but is helpful
    // for debugging a clean package directory.
    const removeThese = [
      "Move.devnet.toml",
      "Move.lock",
      "Makefile",
      "README.md",
      "build",
    ];
    for (const basename of removeThese) {
      fs.rmSync(`${dstWormholePath}/${basename}`, {
        recursive: true,
        force: true,
      });
    }

    // Fix Move.toml file.
    const moveTomlPath = `${dstWormholePath}/Move.toml`;
    const moveToml = fs.readFileSync(moveTomlPath, { encoding: "utf-8" });
    fs.writeFileSync(
      moveTomlPath,
      moveToml.replace(`wormhole = "_"`, `wormhole = "0x0"`),
      { encoding: "utf-8" }
    );
  });

  afterEach("Clean Up Environment", () => {
    // Clean up Wormhole contract directory.
    fs.rmSync(dstWormholePath, { recursive: true, force: true });

    // And clear local variables.
    localVariables.clear();
  });

  afterEach("Publish Message Using Latest Package", async () => {
    const wormholePackage = await getPackageId(
      wallet.provider,
      WORMHOLE_STATE_ID
    );
    const owner = await wallet.getAddress();

    // Create emitter cap.
    const emitterCapId = await (async () => {
      const tx = new TransactionBlock();
      const [emitterCap] = tx.moveCall({
        target: `${wormholePackage}::emitter::new`,
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

      const numMessages = 32;
      const payloads: string[] = [];
      const tx = new TransactionBlock();

      // Construct transaction block to send multiple messages.
      for (let i = 0; i < numMessages; ++i) {
        // Make a unique message.
        const payload = basePayload + `... ${i}`;
        payloads.push(payload);

        const [wormholeFee] = tx.splitCoins(tx.gas, [tx.pure(0)]);
        tx.moveCall({
          target: `${wormholePackage}::publish_message::publish_message`,
          arguments: [
            tx.object(WORMHOLE_STATE_ID),
            tx.object(emitterCapId),
            tx.pure(nonce),
            tx.pure(payload),
            wormholeFee,
            tx.object(SUI_CLOCK_OBJECT_ID),
          ],
        });
      }

      const events = await wallet
        .signAndExecuteTransactionBlock({
          transactionBlock: tx,
          options: {
            showEvents: true,
          },
        })
        .then((result) => result.events!);
      expect(events).has.length(numMessages);

      for (let i = 0; i < numMessages; ++i) {
        const eventData = events[i].parsedJson!;
        expect(eventData.consistency_level).equals(0);
        expect(eventData.nonce).equals(nonce);
        expect(eventData.payload).deep.equals([...Buffer.from(payloads[i])]);
        expect(eventData.sender).equals(emitterCapId);
        expect(eventData.sequence).equals(i.toString());
        expect(BigInt(eventData.timestamp) > 0n).is.true;
      }
    }
  });

  it("Version 1 -> 2: Upgrade Wormhole with New Feature", async () => {
    const wormholePackage = await getPackageId(
      wallet.provider,
      WORMHOLE_STATE_ID
    );

    // TODO: Add new feature module.

    // Prepare upgrade by generating digest for guardinas to sign.
    const digest = buildForDigest(dstWormholePath);
    const signedVaa = generateVaaFromDigest(digest, governance);

    // And execute upgrade with governance VAA.
    const results = await buildAndUpgradeWormhole(
      wallet,
      signedVaa,
      dstWormholePath,
      WORMHOLE_STATE_ID
    );

    // Fetch implementation.
    const latestPackageId = await getPackageId(
      wallet.provider,
      WORMHOLE_STATE_ID
    );

    const implementation = results.effects?.created?.find(
      (item) => item.owner == "Immutable"
    )!;
    expect(implementation?.reference.objectId).equals(latestPackageId);

    // Compare to emitted event.
    expect(results.events!).has.length(1);

    const eventData = results.events![0].parsedJson!;
    expect(eventData.old_contract).equals(wormholePackage);
    expect(eventData.new_contract).equals(latestPackageId);
  });

  it("Version 2 -> 3: Upgrade Wormhole with Breaking Change", async () => {
    const wormholePackage = await getPackageId(
      wallet.provider,
      WORMHOLE_STATE_ID
    );
    // TODO
  });

  it("Version 3 -> 4: Upgrade Wormhole with Existing Module Modification", async () => {
    const wormholePackage = await getPackageId(
      wallet.provider,
      WORMHOLE_STATE_ID
    );
    // TODO
  });
});
