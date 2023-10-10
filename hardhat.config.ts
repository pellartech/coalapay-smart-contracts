import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import { config } from 'dotenv'
config()
const hardhatConfig: HardhatUserConfig = {
  solidity: '0.8.20',
  networks: {
    goerli: {
      url: process.env.GOERLI_PROVIDER_URL,
      accounts: [process.env.PRIVATE_KEY!]
    }
  },
  gasReporter: {
    enabled: true
  }
}

export default hardhatConfig
