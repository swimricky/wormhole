import fs from "fs";
import { resolve } from "path";

export type ParsedMoveToml = {
  name: string;
  rows: { key: string; value: string }[];
}[];

export class MoveToml {
  private toml: ParsedMoveToml;

  constructor(tomlStr: string) {
    this.toml = MoveToml.parse(tomlStr);
  }

  addRow(sectionName: string, key: string, value: string) {
    if (!MoveToml.isValidValue(value)) {
      if (/^\S+$/.test(value)) {
        value = `"${value}"`;
      } else {
        throw new Error(`Invalid value "${value}"`);
      }
    }

    const section = this.getSection(sectionName);
    section.rows.push({ key, value });
    return this;
  }

  getSectionNames(): string[] {
    return this.toml.map((s) => s.name);
  }

  isPublished(): boolean {
    return !!this.getRow("package", "published-at");
  }

  removeRow(sectionName: string, key: string) {
    const section = this.getSection(sectionName);
    section.rows = section.rows.filter((r) => r.key !== key);
    return this;
  }

  serialize(): string {
    let tomlStr = "";
    for (let i = 0; i < this.toml.length; i++) {
      const section = this.toml[i];
      tomlStr += `[${section.name}]\n`;
      for (const row of section.rows) {
        tomlStr += `${row.key} = ${row.value}\n`;
      }

      if (i !== this.toml.length - 1) {
        tomlStr += "\n";
      }
    }

    return tomlStr;
  }

  updateRow(sectionName: string, key: string, value: string) {
    if (!MoveToml.isValidValue(value)) {
      if (/^\S+$/.test(value)) {
        value = `"${value}"`;
      } else {
        throw new Error(`Invalid value "${value}"`);
      }
    }

    const row = this.getRow(sectionName, key);
    row.value = value;
    return this;
  }

  static isValidValue(value: string): boolean {
    value = value.trim();
    return (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("{") && value.endsWith("}")) ||
      (value.startsWith("'") && value.endsWith("'"))
    );
  }

  static parse(tomlStr: string): ParsedMoveToml {
    const toml: ParsedMoveToml = [];
    const lines = tomlStr.split("\n");
    for (const line of lines) {
      // Parse new section
      const sectionMatch = line.trim().match(/^\[(\S+)\]$/);
      if (sectionMatch && sectionMatch.length === 2) {
        toml.push({ name: sectionMatch[1], rows: [] });
        continue;
      }

      // Otherwise, parse row in section. We must handle two cases:
      //  1. value is string, e.g. name = "MyPackage"
      //  2. value is object, e.g. Sui = { local = "../sui-framework" }
      const rowMatch = line.trim().match(/^([a-zA-Z_\-]+) = (.+)$/);
      if (rowMatch && rowMatch.length === 3) {
        toml[toml.length - 1].rows.push({
          key: rowMatch[1],
          value: rowMatch[2],
        });
      }
    }

    return toml;
  }

  private getRow(
    sectionName: string,
    key: string
  ): ParsedMoveToml[number]["rows"][number] {
    const section = this.getSection(sectionName);
    const row = section.rows.find((r) => r.key === key);
    if (row === undefined) {
      throw new Error(`Row "${key}" not found in section "${sectionName}"`);
    }

    return row;
  }

  private getSection(sectionName: string): ParsedMoveToml[number] {
    const section = this.toml.find((s) => s.name === sectionName);
    if (section === undefined) {
      throw new Error(`Section "${sectionName}" not found`);
    }

    return section;
  }
}

const cleanupTempToml = (packagePath: string): void => {
  const defaultTomlPath = getDefaultTomlPath(packagePath);
  const tempTomlPath = getTempTomlPath(packagePath);
  if (fs.existsSync(tempTomlPath)) {
    // Clean up Move.toml for dependencies
    const dependencyPaths = getAllLocalPackageDependencyPaths(defaultTomlPath);
    for (const path of dependencyPaths) {
      cleanupTempToml(path);
    }

    fs.renameSync(tempTomlPath, defaultTomlPath);
  }
};

/**
 * Get Move.toml dependencies by looking for all lines of form 'local = ".*"'.
 * This works because network-specific Move.toml files should not contain
 * dev addresses, so the only lines that match this regex are the dependencies
 * that need to be replaced.
 * @param packagePath
 * @returns
 */
const getAllLocalPackageDependencyPaths = (tomlPath: string): string[] => {
  const tomlStr = fs.readFileSync(tomlPath, "utf8").toString();
  const toml = new MoveToml(tomlStr);

  // Sanity check that Move.toml does not contain dev info since this breaks
  // building and publishing packages
  if (
    toml.getSectionNames().some((name) => name.includes("dev-dependencies")) ||
    toml.getSectionNames().some((name) => name.includes("dev-addresses"))
  ) {
    throw new Error(
      "Network-specific Move.toml should not contain dev-dependencies or dev-addresses."
    );
  }

  const packagePath = getPackagePathFromTomlPath(tomlPath);
  return [...tomlStr.matchAll(/local = "(.*)"/g)].map((match) =>
    resolve(packagePath, match[1])
  );
};

const getDefaultTomlPath = (packagePath: string): string =>
  `${packagePath}/Move.toml`;

const getPackagePathFromTomlPath = (tomlPath: string): string =>
  tomlPath.split("/").slice(0, -1).join("/");

const getTempTomlPath = (packagePath: string): string =>
  `${packagePath}/Move.temp.toml`;

const getTomlPathByNetwork = (packagePath: string, network: string): string =>
  `${packagePath}/Move.${network.toLowerCase()}.toml`;

const getPackageNameFromPath = (packagePath: string): string =>
  packagePath.split("/").pop() || "";

const resetNetworkToml = (
  packagePath: string,
  network: string,
  recursive: boolean = false
): void => {
  const networkTomlPath = getTomlPathByNetwork(packagePath, network);
  const tomlStr = fs.readFileSync(networkTomlPath, "utf8").toString();
  const toml = new MoveToml(tomlStr);
  if (toml.isPublished()) {
    if (recursive) {
      const dependencyPaths =
        getAllLocalPackageDependencyPaths(networkTomlPath);
      for (const path of dependencyPaths) {
        resetNetworkToml(path, network);
      }
    }

    const updatedTomlStr = toml
      .removeRow("package", "published-at")
      .updateRow("addresses", getPackageNameFromPath(packagePath), "_")
      .serialize();
    fs.writeFileSync(networkTomlPath, updatedTomlStr, "utf8");
  }
};

const setupMainToml = (
  packagePath: string,
  network: string,
  isDependency: boolean = false
): void => {
  const defaultTomlPath = getDefaultTomlPath(packagePath);
  const tempTomlPath = getTempTomlPath(packagePath);
  const srcTomlPath = getTomlPathByNetwork(packagePath, network);

  if (fs.existsSync(tempTomlPath)) {
    // It's possible that this dependency has been set up by another package
    if (isDependency) {
      return;
    }

    throw new Error("Move.temp.toml exists, is there a publish in progress?");
  }

  // Make deploying on devnet more convenient by resetting Move.toml so we
  // don't have to manually reset them repeatedly during local development.
  // This is not recursive because we assume that packages are deployed bottom
  // up.
  if (!isDependency && network === "DEVNET") {
    resetNetworkToml(packagePath, network);
  }

  // Save default Move.toml
  if (!fs.existsSync(defaultTomlPath)) {
    throw new Error(
      `Invalid package layout. Move.toml not found at ${defaultTomlPath}`
    );
  }

  fs.renameSync(defaultTomlPath, tempTomlPath);

  // Set Move.toml from appropriate network
  if (!fs.existsSync(srcTomlPath)) {
    throw new Error(`Move.toml for ${network} not found at ${srcTomlPath}`);
  }

  fs.copyFileSync(srcTomlPath, defaultTomlPath);

  // Replace undefined addresses in base Move.toml and ensure dependencies are
  // published
  const tomlStr = fs.readFileSync(defaultTomlPath, "utf8").toString();
  const toml = new MoveToml(tomlStr);
  const packageName = getPackageNameFromPath(packagePath);
  if (!isDependency) {
    if (toml.isPublished()) {
      throw new Error(`Package ${packageName} is already published.`);
    } else {
      toml.updateRow("addresses", packageName, "0x0");
    }

    fs.writeFileSync(defaultTomlPath, toml.serialize());
  } else if (isDependency && !toml.isPublished()) {
    throw new Error(
      `Dependency ${packageName} is not published. Please publish it first.`
    );
  }

  // Set up Move.toml for dependencies
  const dependencyPaths = getAllLocalPackageDependencyPaths(defaultTomlPath);
  for (const path of dependencyPaths) {
    setupMainToml(path, network, true);
  }
};

const updateNetworkToml = (
  packagePath: string,
  network: string,
  packageId: string
): void => {
  const tomlPath = getTomlPathByNetwork(packagePath, network);
  const tomlStr = fs.readFileSync(tomlPath, "utf8");
  const updatedTomlStr = new MoveToml(tomlStr)
    .addRow("package", "published-at", packageId)
    .updateRow("addresses", getPackageNameFromPath(packagePath), packageId)
    .serialize();
  fs.writeFileSync(tomlPath, updatedTomlStr, "utf8");
};
