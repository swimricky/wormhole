// NOTE: modify these to reflect current versions of packages
export const VERSION_WORMHOLE = 1;
export const VERSION_TOKEN_BRIDGE = 1;

// keystore
export const KEYSTORE = [
  "AHpgOYUTRFCL1wVyEnAUpgNAX0/5O/HDOJPgbFH47LFH",
  "AEMKsyl/4+kuR9m2smjXqyAqeaTXmg4wtMxmrrTVLyGU",
  "AD7L+I2k8/xx3kdh1sIdhN0LJqPptRGhKZMugxcS+xh2",
];

// wallets
export const WALLET_PRIVATE_KEY = Buffer.from(KEYSTORE[0], "base64").subarray(
  1
);
export const RELAYER_PRIVATE_KEY = Buffer.from(KEYSTORE[1], "base64").subarray(
  1
);
export const CREATOR_PRIVATE_KEY = Buffer.from(KEYSTORE[2], "base64").subarray(
  1
);

// guardian signer
export const GUARDIAN_PRIVATE_KEY =
  "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";

// wormhole
export const WORMHOLE_STATE_ID =
  "0xb8638c81df0dd88d39f3a7572a96a53aaed6b39c89ec82cd4d81f013be52123d";

// token bridge
export const TOKEN_BRIDGE_STATE_ID =
  "0xa0a0a82bdd3abece5014ca77dd1fb3d540a4c613af6081c509f717133ce1c081";

// governance
export const GOVERNANCE_EMITTER =
  "0000000000000000000000000000000000000000000000000000000000000004";

// file encoding
export const UTF8: BufferEncoding = "utf-8";
