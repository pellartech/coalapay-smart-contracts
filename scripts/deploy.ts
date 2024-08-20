import { ethers } from "hardhat";

const TOKEN_NAME = 'Coala Pay Sudan'
const TOKEN_SYMBOL = 'COALA.SDN'
const TOKEN_URI = 'https://coalapay.org/api/v2/metadata/sudan/'

async function main() {
  const coalaPayImpl = await ethers.getContractFactory('CoalaPay')
  const coalaPayContract = await coalaPayImpl.deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_URI,
  )
  const address = await coalaPayContract.getAddress()
  console.log(`Coala Pay deployed to: ${address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat verify --network mainnet 0x431B1B80f19B392EA7064fb0dBDeEbe138060fC0 "Coala Pay Sudan" "COALA.SDN" "https://coalapay.org/api/v2/metadata/sudan/"