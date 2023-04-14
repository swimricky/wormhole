import { ChainGrpcWasmApi } from "@injectivelabs/sdk-ts";
import { JsonRpcProvider } from "@mysten/sui.js";
import { Commitment, Connection, PublicKeyInitData } from "@solana/web3.js";
import { LCDClient } from "@terra-money/terra.js";
import { Algodv2, getApplicationAddress } from "algosdk";
import { AptosClient } from "aptos";
import { ethers } from "ethers";
import { Bridge__factory } from "../ethers-contracts";
import { getWrappedMeta } from "../solana/tokenBridge";
import { getTokenFromTokenRegistry, isSuiError } from "../sui";
import {
  CHAIN_ID_INJECTIVE,
  coalesceModuleAddress,
  ensureHexPrefix,
  tryNativeToHexString,
} from "../utils";
import { safeBigIntToNumber } from "../utils/bigint";
import { getForeignAssetInjective } from "./getForeignAsset";

/**
 * Returns whether or not an asset address on Ethereum is a wormhole wrapped asset
 * @param tokenBridgeAddress
 * @param provider
 * @param assetAddress
 * @returns
 */
export async function getIsWrappedAssetEth(
  tokenBridgeAddress: string,
  provider: ethers.Signer | ethers.providers.Provider,
  assetAddress: string
): Promise<boolean> {
  if (!assetAddress) return false;
  const tokenBridge = Bridge__factory.connect(tokenBridgeAddress, provider);
  return await tokenBridge.isWrappedAsset(assetAddress);
}

// TODO: this doesn't seem right
export async function getIsWrappedAssetTerra(
  tokenBridgeAddress: string,
  client: LCDClient,
  assetAddress: string
): Promise<boolean> {
  return false;
}

/**
 * Checks if the asset is a wrapped asset
 * @param tokenBridgeAddress The address of the Injective token bridge contract
 * @param client Connection/wallet information
 * @param assetAddress Address of the asset in Injective format
 * @returns true if asset is a wormhole wrapped asset
 */
export async function getIsWrappedAssetInjective(
  tokenBridgeAddress: string,
  client: ChainGrpcWasmApi,
  assetAddress: string
): Promise<boolean> {
  const hexified = tryNativeToHexString(assetAddress, "injective");
  const result = await getForeignAssetInjective(
    tokenBridgeAddress,
    client,
    CHAIN_ID_INJECTIVE,
    new Uint8Array(Buffer.from(hexified))
  );
  if (result === null) {
    return false;
  }
  return true;
}

/**
 * Returns whether or not an asset on Solana is a wormhole wrapped asset
 * @param connection
 * @param tokenBridgeAddress
 * @param mintAddress
 * @param [commitment]
 * @returns
 */
export async function getIsWrappedAssetSolana(
  connection: Connection,
  tokenBridgeAddress: PublicKeyInitData,
  mintAddress: PublicKeyInitData,
  commitment?: Commitment
): Promise<boolean> {
  if (!mintAddress) {
    return false;
  }
  return getWrappedMeta(connection, tokenBridgeAddress, mintAddress, commitment)
    .catch((_) => null)
    .then((meta) => meta != null);
}

export const getIsWrappedAssetSol = getIsWrappedAssetSolana;

/**
 * Returns whethor or not an asset on Algorand is a wormhole wrapped asset
 * @param client Algodv2 client
 * @param tokenBridgeId token bridge ID
 * @param assetId Algorand asset index
 * @returns true if the asset is wrapped
 */
export async function getIsWrappedAssetAlgorand(
  client: Algodv2,
  tokenBridgeId: bigint,
  assetId: bigint
): Promise<boolean> {
  if (assetId === BigInt(0)) {
    return false;
  }
  const tbAddr: string = getApplicationAddress(tokenBridgeId);
  const assetInfo = await client.getAssetByID(safeBigIntToNumber(assetId)).do();
  const creatorAddr = assetInfo.params.creator;
  const creatorAcctInfo = await client.accountInformation(creatorAddr).do();
  const wormhole: boolean = creatorAcctInfo["auth-addr"] === tbAddr;
  return wormhole;
}

export function getIsWrappedAssetNear(
  tokenBridge: string,
  asset: string
): boolean {
  return asset.endsWith("." + tokenBridge);
}

/**
 * Determines whether or not given address is wrapped or native to Aptos.
 * @param client Client used to transfer data to/from Aptos node
 * @param tokenBridgeAddress Address of token bridge
 * @param assetFullyQualifiedType Fully qualified type of asset
 * @returns True if asset is wrapped
 */
export async function getIsWrappedAssetAptos(
  client: AptosClient,
  tokenBridgeAddress: string,
  assetFullyQualifiedType: string
): Promise<boolean> {
  assetFullyQualifiedType = ensureHexPrefix(assetFullyQualifiedType);
  try {
    // get origin info from asset address
    await client.getAccountResource(
      coalesceModuleAddress(assetFullyQualifiedType),
      `${tokenBridgeAddress}::state::OriginInfo`
    );
    return true;
  } catch {
    return false;
  }
}

export async function getIsWrappedAssetSui(
  provider: JsonRpcProvider,
  tokenBridgeAddress: string,
  tokenBridgeStateObjectId: string,
  type: string
): Promise<boolean> {
  // An easy way to determine if given asset isn't a wrapped asset is to ensure
  // module name and struct name are coin and COIN respectively.
  if (!type.endsWith("::coin::COIN")) {
    return false;
  }

  try {
    // This call errors if the type doesn't exist in the TokenRegistry
    await getTokenFromTokenRegistry(
      provider,
      tokenBridgeAddress,
      tokenBridgeStateObjectId,
      type
    );
    return true;
  } catch (e) {
    if (isSuiError(e) && e.code === -32000 && e.message.includes("RPC Error")) {
      return false;
    }

    throw e;
  }
}
