import { ethers } from "hardhat";

const FEE_TO = "0x21c10038fC68d1f05400b2693dAe30772a1736a3";

async function main() {
  const coalaPayImpl = await ethers.getContractFactory(
    "CoalaPayPaymentSplitter"
  );
  const coalaPayContract = await coalaPayImpl.deploy(
    FEE_TO
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

// npx hardhat verify --network mainnet 0x56163ca4A5155732334e4D415B0f02D24c088678 "0x21c10038fC68d1f05400b2693dAe30772a1736a3"