import { expect } from "chai";
import * as mock from "@certusone/wormhole-sdk/lib/cjs/mock";

import {
  CREATOR_PRIVATE_KEY,
  GUARDIAN_PRIVATE_KEY,
  RELAYER_PRIVATE_KEY,
  WALLET_PRIVATE_KEY,
} from "./helpers/consts";
import {
  Ed25519Keypair,
  JsonRpcProvider,
  localnetConnection,
  RawSigner,
} from "@mysten/sui.js";

describe(" 3. Upgradability", () => {
  const provider = new JsonRpcProvider(localnetConnection);

  // User wallet.
  const wallet = new RawSigner(
    Ed25519Keypair.fromSecretKey(WALLET_PRIVATE_KEY),
    provider
  );

  // Relayer wallet.
  const relayer = new RawSigner(
    Ed25519Keypair.fromSecretKey(RELAYER_PRIVATE_KEY),
    provider
  );

  // Deployer wallet.
  const creator = new RawSigner(
    Ed25519Keypair.fromSecretKey(CREATOR_PRIVATE_KEY),
    provider
  );

  // Mock guardians for signing wormhole messages.
  const guardians = new mock.MockGuardians(0, [GUARDIAN_PRIVATE_KEY]);

  before("Setup", async () => {
    // TODO
  });

  after("Clean Up", async () => {
    // TODO
  });

  describe("Initialize and Upgrade Wormhole", () => {
    const localVariables = {};

    it("Build Dummy Package as New Implementation", async () => {
      // TODO
    });

    it("Authorize Upgrade", async () => {
      // TODO
    });

    it("Upgrade", async () => {
      // TODO
    });

    it("Commit Upgrade", async () => {
      // TODO
    });

    it("Verify Implementation", async () => {
      // TODO
    });
  });
});
