// scripts/deploy-lastmile.ts
import { ethers, run } from "hardhat";

/* -------------------------------------------------------------------------- */
/*                               Configurable                                 */
/* -------------------------------------------------------------------------- */
const BASE_URI =
  "https://federation-stage.coalapay.org/api/v2/metadata/DRC_SUDAN_HH/"; // metadata prefix
const NFT_NAME = "DRC Sudan Last Mile Cash Payments";
const NFT_SYMBOL = "LMP.DRC.SDN";

const BATCH_PROCESSOR = "0x02a7A2EEFCa4718BF56D265361B11392F55947d6"; // backend wallet

/* -------------------------------------------------------------------------- */
/*                               Deployment                                   */
/* -------------------------------------------------------------------------- */
async function main() {
  console.log("Deploying LastMileCashPayments…");

  const Factory = await ethers.getContractFactory("LastMileCashPayments");
  const lmp = await Factory.deploy(BASE_URI, NFT_NAME, NFT_SYMBOL);
  
  await lmp.waitForDeployment();
  const contractAddress = await lmp.getAddress();
  console.log(`✅ Deployed at ${contractAddress}`);

  // Grant BATCH_PROCESSOR_ROLE to the backend wallet
  const BATCH_ROLE = await lmp.BATCH_PROCESSOR_ROLE();
  let tx = await lmp.grantRole(BATCH_ROLE, BATCH_PROCESSOR);
  await tx.wait();
  console.log(`✅ Granted BATCH_PROCESSOR_ROLE to ${BATCH_PROCESSOR}`);

  /* ----------------------------- Verification ----------------------------- */
  try {
    console.log("Verifying on Etherscan...");
    // small delay so the bytecode propagates
    await new Promise((r) => setTimeout(r, 10000));

    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [BASE_URI, NFT_NAME, NFT_SYMBOL],
    });
    console.log("✅ Verified.");
  } catch (err) {
    console.warn("⚠️  Verification failed (maybe already verified):", err);
  }

  /* ------------------------------- Roles ---------------------------------- */

  console.log("🎉  All done!");
}

/* -------------------------------------------------------------------------- */
/*                                   Run                                      */
/* -------------------------------------------------------------------------- */
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
