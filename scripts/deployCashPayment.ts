// scripts/deploy.js
import { ethers, run } from "hardhat";

const HOLDING_ACCOUNT = "0xde62C75255e6cd1EC7C5dAAFDEF1aC1ABaae1848";
const FUNDING_ACCOUNT = "0xfB71C8ff525C40C38799Adb5531A79D5e6334460";
const FEE_RECEIVER = "0x21c10038fC68d1f05400b2693dAe30772a1736a3"; // caola pay

// Example: 500 => 5% fee (because FEE_DIVISOR is 10000 in the contract)
const FEE_PERCENT = 500;

const API_WALLET = "0xd9509c87c09F6E11D86006Bd1f68a47321577824";

async function main() {
  // Deploy contract with all four constructor args
  const CoalaPayCashPayments = await ethers.getContractFactory("CoalaPayCashPayments");
  const coalaPay = await CoalaPayCashPayments.deploy(
    HOLDING_ACCOUNT,
    FUNDING_ACCOUNT,
    FEE_RECEIVER,
    FEE_PERCENT
  );

  await coalaPay.waitForDeployment();

  const contractAddress = await coalaPay.getAddress();
  console.log("CoalaPayCashPayments deployed to:", contractAddress);

  // Optional delay before Etherscan verify
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Attempt to verify on Etherscan
  try {
    console.log("Verifying on Etherscan...");
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [
        HOLDING_ACCOUNT,
        FUNDING_ACCOUNT,
        FEE_RECEIVER,
        FEE_PERCENT
      ],
    });
    console.log("Verification complete.");
  } catch (err) {
    console.log("Verification attempt failed:", err);
  }

  // Grant all roles to the API_WALLET (except admin)
  const FUNDER_ROLE = await coalaPay.FUNDER_ROLE();
  const WHITELIST_USER_ROLE = await coalaPay.WHITELIST_USER_ROLE();
  const PAYMENT_CYCLE_ROLE = await coalaPay.PAYMENT_CYCLE_ROLE();

  // Grant Funder role
  let tx = await coalaPay.grantRole(FUNDER_ROLE, API_WALLET);
  await tx.wait();
  console.log(`Granted FUNDER_ROLE to ${API_WALLET}`);

  // Grant Whitelist User role
  tx = await coalaPay.grantRole(WHITELIST_USER_ROLE, API_WALLET);
  await tx.wait();
  console.log(`Granted WHITELIST_USER_ROLE to ${API_WALLET}`);

  // Grant Payment Cycle role
  tx = await coalaPay.grantRole(PAYMENT_CYCLE_ROLE, API_WALLET);
  await tx.wait();
  console.log(`Granted PAYMENT_CYCLE_ROLE to ${API_WALLET}`);

  console.log("All done!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
