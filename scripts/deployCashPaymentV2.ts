// scripts/deploy-lastmile.ts
import { ethers, run } from "hardhat";

const TOKEN_NAME = "CP.MKT.03";
const TOKEN_SYMBOL = "CP.MKT.03";
const TOKEN_URI = "https://federation.coalapay.org/api/v2/metadata/";
// const INITIAL_ADMIN = '0x8Bd9FFe190066Ba69f699670543161B3cC2E3aaB' // DRC STAGE
const INITIAL_ADMIN = "0x937A36D7401a7193E0DDd852191242DFA89248be"; // DRC MAINNET
const FEE_TO = "0x6977D98d3A4977441821e882579B41403f60D3bC"; // DRC FEE RECEIVER

/* -------------------------------------------------------------------------- */
/*                               Deployment                                   */
/* -------------------------------------------------------------------------- */
async function main() {
  console.log("Deploying LastMileCashPayments…");

  const Factory = await ethers.getContractFactory("LastMileCashPayments");
  const lmp = await Factory.deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_URI,
    INITIAL_ADMIN,
    FEE_TO
  );

  await lmp.waitForDeployment();
  const contractAddress = await lmp.getAddress();
  console.log(`✅ Deployed at ${contractAddress}`);

  // Grant BATCH_PROCESSOR_ROLE to the backend wallet
  const BATCH_ROLE = await lmp.BATCH_PROCESSOR_ROLE();
  let tx = await lmp.grantRole(BATCH_ROLE, INITIAL_ADMIN);
  await tx.wait();
  console.log(`✅ Granted BATCH_PROCESSOR_ROLE to ${INITIAL_ADMIN}`);

  /* ----------------------------- Verification ----------------------------- */
  try {
    console.log("Verifying on Etherscan...");
    // small delay so the bytecode propagates
    await new Promise((r) => setTimeout(r, 10000));

    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_URI,
        INITIAL_ADMIN,
        FEE_TO,
      ],
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
