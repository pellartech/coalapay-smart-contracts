import { ethers } from "hardhat";

async function main() {
  const coalaPayImpl = await ethers.getContractFactory('CoalaPay')
  const coalaPayContract = await coalaPayImpl.deploy()
  const address = coalaPayContract.address
  console.log(`Coala Pay deployed to: ${address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
