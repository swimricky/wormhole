import * as mock from "@certusone/wormhole-sdk/lib/cjs/mock";
import { GUARDIAN_PRIVATE_KEY } from "./consts";

export function generateVaaFromDigest(
  digest: Buffer,
  governance: mock.GovernanceEmitter
) {
  const timestamp = 12345678;
  const published = governance.publishWormholeUpgradeContract(
    timestamp,
    2,
    "0x" + digest.toString("hex")
  );

  // Sui is not supported yet by the SDK, so we need to adjust the payload.
  published.writeUInt16BE(21, published.length - 34);

  // We will use the signed VAA when we execute the upgrade.
  const guardians = new mock.MockGuardians(0, [GUARDIAN_PRIVATE_KEY]);
  return guardians.addSignatures(published, [0]);
}
