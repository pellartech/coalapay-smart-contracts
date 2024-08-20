import { ethers } from "hardhat";

async function main() {
  const USDT = await ethers.getContractFactory('TokenERC20')
  const usdt = await USDT.deploy()
  const address = await usdt.getAddress()
  console.log(`Coala Pay deployed to: ${address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
