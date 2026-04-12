import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    xlayer: {
      url: process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech",
      chainId: 196,
      accounts,
    },
    xlayerTestnet: {
      url: process.env.XLAYER_TESTNET_RPC ?? "https://testrpc.xlayer.tech",
      chainId: 1952,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      xlayer: process.env.OKLINK_API_KEY ?? "any",
      xlayerTestnet: process.env.OKLINK_API_KEY ?? "any",
    },
    customChains: [
      {
        network: "xlayer",
        chainId: 196,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER",
          browserURL: "https://www.oklink.com/xlayer",
        },
      },
      {
        network: "xlayerTestnet",
        chainId: 1952,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET",
          browserURL: "https://www.oklink.com/xlayer-test",
        },
      },
    ],
  },
};

export default config;
