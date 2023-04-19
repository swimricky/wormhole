import { expect } from "chai";
import { execSync } from "child_process";
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
  TransactionEffects,
} from "@mysten/sui.js";

import { buildForBytecode, buildForDigest, EXEC_UTF8 } from "./helpers/build";
import {
  GOVERNANCE_EMITTER,
  KEYSTORE,
  VERSION_WORMHOLE,
  WALLET_PRIVATE_KEY,
  WORMHOLE_STATE_ID,
} from "./helpers/consts";
import {
  cleanUpPackageDirectory,
  generateVaaFromDigest,
  modifyHardCodedVersionControl,
  setUpWormholeDirectory,
} from "./helpers/setup";
import { buildAndUpgradeWormhole, migrate } from "./helpers/upgrade";
import { getPackageId } from "./helpers/utils";
import { MoveAbort } from "./helpers/error/moveAbort";
import { parseWormholeError } from "./helpers/error/wormhole";

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
  const srcWormholePath = resolve(`${__dirname}/../../wormhole`);
  const dstWormholePath = resolve(`${__dirname}/../wormhole`);

  before("Publish Wormhole", async () => {});

  beforeEach("Set Up Environment", () => {
    setUpWormholeDirectory(srcWormholePath, dstWormholePath);
  });

  afterEach("Clean Up Environment", () => {
    cleanUpPackageDirectory(dstWormholePath);
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
          const found = result.objectChanges?.filter(
            (item) => "created" === item.type!
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

      const results = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        options: {
          showEvents: true,
          showEffects: true,
        },
      });
      expect(results.effects?.status.status).equals("success");

      const events = results.events!;
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

  describe("Expected Failure", () => {
    const creatorKey = KEYSTORE[2];

    // Persisting variables across tests.
    const localVariables: Map<string, any> = new Map();

    beforeEach("Build, Publish and Set Up Environment", () => {
      // Copy Move.toml for devnet.
      fs.copyFileSync(
        `${srcWormholePath}/Move.devnet.toml`,
        `${dstWormholePath}/Move.devnet.toml`
      );

      const packageId = execSync(
        `worm sui deploy ${dstWormholePath} -n devnet -k ${creatorKey} 2> /dev/null`,
        EXEC_UTF8
      )
        .matchAll(/Published to (0x[a-z0-9]{64})/g)
        .next().value[1];

      // Finally clean up.
      cleanUpPackageDirectory(dstWormholePath);

      // TODO: Initialize wormhole
      const stateId = execSync(
        `worm sui init-wormhole -n devnet -k ${creatorKey} -p ${packageId} -i befa429d57cd18b7f8a4d91a2da9ab4af05d0fbe 2> /dev/null`,
        EXEC_UTF8
      )
        .matchAll(/Wormhole state object ID (0x[a-z0-9]{64})/g)
        .next().value[1];

      localVariables.set("wormholeStateId", stateId);

      // Now set up for upgrade.
      setUpWormholeDirectory(srcWormholePath, dstWormholePath);
    });

    afterEach("Clean Up Local Variables", () => {
      localVariables.clear();
    });

    it("Cannot Migrate After Upgrade w/ Stale CURRENT_BUILD_VERSION", async () => {
      const wormholeStateId: string = localVariables.get("wormholeStateId");

      const wormholePackage = await getPackageId(
        wallet.provider,
        wormholeStateId
      );

      // Prepare upgrade by generating digest for guardinas to sign.
      const digest = buildForDigest(dstWormholePath);
      const signedVaa = generateVaaFromDigest(digest, governance);

      // And execute upgrade with governance VAA.
      const upgradeResults = await buildAndUpgradeWormhole(
        wallet,
        signedVaa,
        dstWormholePath,
        wormholeStateId
      );
      expect(upgradeResults.effects?.status.status).equals("success");

      // Fetch implementation.
      const latestPackageId = await getPackageId(
        wallet.provider,
        wormholeStateId
      );

      const implementation = upgradeResults.effects?.created?.find(
        (item) => item.owner == "Immutable"
      )!;
      expect(implementation?.reference.objectId).equals(latestPackageId);

      // Compare to emitted event.
      expect(upgradeResults.events!).has.length(1);

      const eventData = upgradeResults.events![0].parsedJson!;
      expect(eventData.old_contract).equals(wormholePackage);
      expect(eventData.new_contract).equals(latestPackageId);

      // Now migrate.
      const migrateTicket = await wallet.provider
        .getDynamicFields({
          parentId: wormholeStateId,
        })
        .then((fields) => fields.data[0].objectType)
        .catch((error) => {
          console.log("should not happen", error);
          return null;
        });
      expect(migrateTicket).is.not.null;
      expect(migrateTicket?.endsWith("MigrateTicket")).is.true;

      // This will fail because the `check_minimum_requirement` is expecting
      // the hard-coded value to be 2 when it is still 1.
      const migrateResults = await migrate(wallet, wormholeStateId).catch(
        (error) => {
          const abort = parseWormholeError(error.cause.effects.status.error);
          expect(abort).equals("E_OUTDATED_VERSION");

          return null;
        }
      );
      expect(migrateResults).is.null;
    });

    it("Cannot Upgrade Using Stale Package", async () => {
      const wormholeStateId: string = localVariables.get("wormholeStateId");

      const wormholePackage = await getPackageId(
        wallet.provider,
        wormholeStateId
      );

      // Make sure the build's hard-coded version is upticked.
      modifyHardCodedVersionControl(
        dstWormholePath,
        VERSION_WORMHOLE,
        VERSION_WORMHOLE + 1 // new build version
      );

      // Prepare upgrade by generating digest for guardinas to sign.
      const digest = buildForDigest(dstWormholePath);
      const signedVaa = generateVaaFromDigest(digest, governance);

      // And execute upgrade with governance VAA.
      const upgradeResults = await buildAndUpgradeWormhole(
        wallet,
        signedVaa,
        dstWormholePath,
        wormholeStateId
      );
      expect(upgradeResults.effects?.status.status).equals("success");

      // And execute again with another VAA. But reference the OG package.
      modifyHardCodedVersionControl(
        dstWormholePath,
        VERSION_WORMHOLE + 1,
        VERSION_WORMHOLE + 2 // new build version
      );

      const anotherDigest = buildForDigest(dstWormholePath);
      const anotherSignedVaa = generateVaaFromDigest(anotherDigest, governance);
      const tx = new TransactionBlock();

      // Authorize upgrade.
      const [upgradeTicket] = tx.moveCall({
        target: `${wormholePackage}::upgrade_contract::authorize_upgrade`,
        arguments: [
          tx.object(wormholeStateId),
          tx.pure(Array.from(anotherSignedVaa)),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });

      // Build and generate modules and dependencies for upgrade.
      const { modules, dependencies } = buildForBytecode(dstWormholePath);
      const [upgradeReceipt] = tx.upgrade({
        modules,
        dependencies,
        packageId: wormholePackage,
        ticket: upgradeTicket,
      });

      // Commit upgrade.
      tx.moveCall({
        target: `${wormholePackage}::upgrade_contract::commit_upgrade`,
        arguments: [tx.object(wormholeStateId), upgradeReceipt],
      });

      // Cannot auto compute gas budget, so we need to configure it manually.
      // Gas ~215m.
      tx.setGasBudget(215_000_000n);

      const anotherUpgradeResults = await wallet.signAndExecuteTransactionBlock(
        {
          transactionBlock: tx,
          options: {
            showEffects: true,
            showEvents: true,
          },
        }
      );
      expect(anotherUpgradeResults.effects?.status.status).equals("failure");

      const error = anotherUpgradeResults.effects?.status.error!;
      expect(error).includes("PackageUpgradeError");
      expect(error).includes("upgrade_error: PackageIDDoesNotMatch");
    });
  });

  describe("Successful Upgrade", () => {
    it("Add New Feature", async () => {
      const wormholePackage = await getPackageId(
        wallet.provider,
        WORMHOLE_STATE_ID
      );

      // Make sure the build's hard-coded version is upticked.
      modifyHardCodedVersionControl(
        dstWormholePath,
        VERSION_WORMHOLE,
        VERSION_WORMHOLE + 1 // new build version
      );

      // TODO: Add new feature module.

      // Prepare upgrade by generating digest for guardinas to sign.
      const digest = buildForDigest(dstWormholePath);
      const signedVaa = generateVaaFromDigest(digest, governance);

      // And execute upgrade with governance VAA.
      const upgradeResults = await buildAndUpgradeWormhole(
        wallet,
        signedVaa,
        dstWormholePath,
        WORMHOLE_STATE_ID
      );
      expect(upgradeResults.effects?.status.status).equals("success");

      // Fetch implementation.
      const latestPackageId = await getPackageId(
        wallet.provider,
        WORMHOLE_STATE_ID
      );

      const implementation = upgradeResults.effects?.created?.find(
        (item) => item.owner == "Immutable"
      )!;
      expect(implementation?.reference.objectId).equals(latestPackageId);

      // Compare to emitted event.
      expect(upgradeResults.events!).has.length(1);

      const eventData = upgradeResults.events![0].parsedJson!;
      expect(eventData.old_contract).equals(wormholePackage);
      expect(eventData.new_contract).equals(latestPackageId);

      // Now migrate.
      const migrateTicket = await wallet.provider
        .getDynamicFields({
          parentId: WORMHOLE_STATE_ID,
        })
        .then((fields) => fields.data[0].objectType)
        .catch((error) => {
          console.log("should not happen", error);
          return null;
        });
      expect(migrateTicket).is.not.null;
      expect(migrateTicket?.endsWith("MigrateTicket")).is.true;

      const migrateResults = await migrate(wallet, WORMHOLE_STATE_ID);
      const migrateEvents = migrateResults.events!;
      expect(migrateEvents).has.length(1);

      const migrateEventData = migrateEvents[0].parsedJson!;
      expect(migrateEventData.version).equals("2");
    });

    it.skip("Modify Existing Module", async () => {
      const wormholePackage = await getPackageId(
        wallet.provider,
        WORMHOLE_STATE_ID
      );

      // Make sure the build's hard-coded version is upticked.
      modifyHardCodedVersionControl(
        dstWormholePath,
        VERSION_WORMHOLE,
        VERSION_WORMHOLE + 2 // new build version (upticked from previous test)
      );

      // TODO: modify publish message.

      // Prepare upgrade by generating digest for guardinas to sign.
      const digest = buildForDigest(dstWormholePath);
      const signedVaa = generateVaaFromDigest(digest, governance);

      // And execute upgrade with governance VAA.
      const upgradeResults = await buildAndUpgradeWormhole(
        wallet,
        signedVaa,
        dstWormholePath,
        WORMHOLE_STATE_ID
      );
      expect(upgradeResults.effects?.status.status).equals("success");

      // Fetch implementation.
      const latestPackageId = await getPackageId(
        wallet.provider,
        WORMHOLE_STATE_ID
      );

      const implementation = upgradeResults.effects?.created?.find(
        (item) => item.owner == "Immutable"
      )!;
      expect(implementation?.reference.objectId).equals(latestPackageId);

      // Compare to emitted event.
      expect(upgradeResults.events!).has.length(1);

      const eventData = upgradeResults.events![0].parsedJson!;
      expect(eventData.old_contract).equals(wormholePackage);
      expect(eventData.new_contract).equals(latestPackageId);

      // Now migrate.
      const migrateTicket = await wallet.provider
        .getDynamicFields({
          parentId: WORMHOLE_STATE_ID,
        })
        .then((fields) => fields.data[0].objectType)
        .catch((error) => {
          console.log("should not happen", error);
          return null;
        });
      expect(migrateTicket).is.not.null;
      expect(migrateTicket?.endsWith("MigrateTicket")).is.true;

      const migrateResults = await migrate(wallet, WORMHOLE_STATE_ID);
      const migrateEvents = migrateResults.events!;
      expect(migrateEvents).has.length(1);

      const migrateEventData = migrateEvents[0].parsedJson!;
      expect(migrateEventData.version).equals("3");

      // Execute Token Bridge and find new event.
    });

    it.skip("Add Breaking Change", async () => {
      const wormholePackage = await getPackageId(
        wallet.provider,
        WORMHOLE_STATE_ID
      );

      // Make sure the build's hard-coded version is upticked.
      modifyHardCodedVersionControl(
        dstWormholePath,
        VERSION_WORMHOLE,
        VERSION_WORMHOLE + 3 // new build version (upticked from previous test)
      );

      // TODO: No need to modify publish message. But require that the current
      // version for publish message be "4" in the migrate module.

      // Prepare upgrade by generating digest for guardinas to sign.
      const digest = buildForDigest(dstWormholePath);
      const signedVaa = generateVaaFromDigest(digest, governance);

      // And execute upgrade with governance VAA.
      const upgradeResults = await buildAndUpgradeWormhole(
        wallet,
        signedVaa,
        dstWormholePath,
        WORMHOLE_STATE_ID
      );
      expect(upgradeResults.effects?.status.status).equals("success");

      // Fetch implementation.
      const latestPackageId = await getPackageId(
        wallet.provider,
        WORMHOLE_STATE_ID
      );

      const implementation = upgradeResults.effects?.created?.find(
        (item) => item.owner == "Immutable"
      )!;
      expect(implementation?.reference.objectId).equals(latestPackageId);

      // Compare to emitted event.
      expect(upgradeResults.events!).has.length(1);

      const eventData = upgradeResults.events![0].parsedJson!;
      expect(eventData.old_contract).equals(wormholePackage);
      expect(eventData.new_contract).equals(latestPackageId);

      // Now migrate.
      const migrateTicket = await wallet.provider
        .getDynamicFields({
          parentId: WORMHOLE_STATE_ID,
        })
        .then((fields) => fields.data[0].objectType)
        .catch((error) => {
          console.log("should not happen", error);
          return null;
        });
      expect(migrateTicket).is.not.null;
      expect(migrateTicket?.endsWith("MigrateTicket")).is.true;

      const migrateResults = await migrate(wallet, WORMHOLE_STATE_ID);
      const migrateEvents = migrateResults.events!;
      expect(migrateEvents).has.length(1);

      const migrateEventData = migrateEvents[0].parsedJson!;
      expect(migrateEventData.version).equals("4");

      // Attempt to execute Token Bridge.
    });
  });
});
