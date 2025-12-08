import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { config } from "dotenv";
config();
const hardhatConfig: HardhatUserConfig = {
  sourcify: {
    enabled: true
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_PROVIDER_URL,
      accounts: [process.env.PRIVATE_KEY!],
    },
    mainnet: {
      url: process.env.ETHEREUM_PROVIDER_URL,
      accounts: [process.env.PRIVATE_KEY!],
    },
    pegasus: {
      url: process.env.PEGASUS_PROVIDER_URL,
      accounts: [process.env.PRIVATE_KEY!],
    },
    phoenix: {
      url: process.env.PHOENIX_PROVIDER_URL,
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
  gasReporter: {
    enabled: true,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "pegasus",
        chainId: 1891,
        urls: {
          apiURL: "https://pegasus.lightlink.io/api",
          browserURL: "https://pegasus.lightlink.io",
        },
      },
      {
        network: "phoenix",
        chainId: 1890,
        urls: {
          apiURL: "https://phoenix.lightlink.io/api",
          browserURL: "https://phoenix.lightlink.io",
        },
      },
    ],
  },
};
// npx hardhat verify --network sepolia 0x6F5fe83d5a6A8d206304185606A34993C4E5B2AB
export default hardhatConfig;
