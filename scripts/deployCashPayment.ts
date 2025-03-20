// scripts/deploy.js

import { ethers, run } from "hardhat";

// Replace with the actual address that will act as the holding account for tokens.
const HOLDING_ACCOUNT = "0xde62C75255e6cd1EC7C5dAAFDEF1aC1ABaae1848";

const FUNDING_ACCOUNT = "0xfB71C8ff525C40C38799Adb5531A79D5e6334460";

const API_WALLET = "0xd9509c87c09F6E11D86006Bd1f68a47321577824";

async function main() {
  const CoalaPayCashPayments = await ethers.getContractFactory("CoalaPayCashPayments");
  const coalaPay = await CoalaPayCashPayments.deploy(HOLDING_ACCOUNT, FUNDING_ACCOUNT);

  await coalaPay.waitForDeployment();

  const contractAddress = await coalaPay.getAddress();
  console.log("CoalaPayCashPayments deployed to:", contractAddress);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    console.log("Verifying on Etherscan...");
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [HOLDING_ACCOUNT, FUNDING_ACCOUNT],
    });
    console.log("Verification complete.");
  } catch (err) {
    console.log("Verification attempt failed:", err);
  }

  await coalaPay.grantRole(await ethers.ZeroHash, API_WALLET);

  await coalaPay.grantFunderRole(API_WALLET);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
