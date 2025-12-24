import { ethers, run } from "hardhat";

const TOKEN_NAME = "CP.MKT.A2";
const TOKEN_SYMBOL = "CP.MKT.A2";
const TOKEN_URI = "https://federation.coalapay.org/api/v2/metadata/";

const FEE_TO = "0x6977D98d3A4977441821e882579B41403f60D3bC"; // DRC FEE RECEIVER
const PAYER = "0x937A36D7401a7193E0DDd852191242DFA89248be"; // DRC MAINNET
// const PAYER = "0x8Bd9FFe190066Ba69f699670543161B3cC2E3aaB"; // DRC TESTNET

async function main() {
  const coalaPayImpl = await ethers.getContractFactory("CoalaPayV2");
  const coalaPayContract = await coalaPayImpl.deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_URI,
    PAYER,
    FEE_TO
  );

  const address = await coalaPayContract.getAddress();

  console.log(`Coala Pay deployed to: ${address}`);
  // wait 5 seconds for deployment

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // set payer
  const tx = await coalaPayContract.setProjectPayer(PAYER);
  await tx.wait();
  console.log(`Set ${PAYER} as payer`);

  try {
    console.log("Verifying on Etherscan...");
    await run("verify:verify", {
      address,
      constructorArguments: [
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_URI,
        PAYER,
        FEE_TO,
      ],
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

// npx hardhat verify --network mainnet 0xfB4f5f6Eb3b9c3A66aCec849Fc8C02B9b4FA9A9b "CP.MKT.A2" "CP.MKT.A2" "https://federation-stage.coalapay.org/api/v2/metadata/" "0x8Bd9FFe190066Ba69f699670543161B3cC2E3aaB" "0x6977D98d3A4977441821e882579B41403f60D3bC"
