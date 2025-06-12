import { ethers, run } from "hardhat";

const TOKEN_NAME = "Coala Pay DRC Sudan Groups";
const TOKEN_SYMBOL = "COALA.DRC.G";
const TOKEN_URI =
  "https://federation-stage.coalapay.org/api/v2/metadata/drc_sudan_groups/";

const COALA_ADMINS: string[] = [
  "0x837e4378fec7ea509ce80d24486512554b6512d3",
  "0x384dAb1c3e200479aC8e40B4Ac127044D791A0ea",
];

const PAYER = "0x02a7A2EEFCa4718BF56D265361B11392F55947d6";

async function main() {
  const coalaPayImpl = await ethers.getContractFactory("CoalaPayV2");
  const coalaPayContract = await coalaPayImpl.deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_URI
  );
  
  const address = await coalaPayContract.getAddress();

  console.log(`Coala Pay deployed to: ${address}`);
  // wait 5 seconds for deployment

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // set each admin
  for (const admin of COALA_ADMINS) {
    const tx = await coalaPayContract.grantRole(ethers.ZeroHash, admin);
    await tx.wait();
    console.log(`Set ${admin} as admin`);
  }

  // set payer
  const tx = await coalaPayContract.setProjectPayer(PAYER);
  await tx.wait();
  console.log(`Set ${PAYER} as payer`);

  try {
    console.log("Verifying on Etherscan...");
    await run("verify:verify", {
      address,
      constructorArguments: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI],
    });
  } catch (err) {
    console.log("Verification attempt failed:", err);
  }
  console.log("Verification complete.");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
