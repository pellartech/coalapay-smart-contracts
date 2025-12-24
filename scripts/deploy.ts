import { ethers } from "hardhat";

const TOKEN_NAME = 'CP.MKT.A1'
const TOKEN_SYMBOL = 'CP.MKT.A1'
const TOKEN_URI = 'https://federation.coalapay.org/api/v2/metadata/'
// const INITIAL_ADMIN = '0x8Bd9FFe190066Ba69f699670543161B3cC2E3aaB' // DRC STAGE
const INITIAL_ADMIN = '0x937A36D7401a7193E0DDd852191242DFA89248be' // DRC MAINNET
const FEE_TO = '0x6977D98d3A4977441821e882579B41403f60D3bC' // DRC FEE RECEIVER

async function main() {
  const coalaPayImpl = await ethers.getContractFactory('CoalaPay')
  const coalaPayContract = await coalaPayImpl.deploy(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_URI,
    INITIAL_ADMIN,
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

// npx hardhat verify --network mainnet 0x431B1B80f19B392EA7064fb0dBDeEbe138060fC0 "Coala Pay Sudan" "COALA.SDN" "https://coalapay.org/api/v2/metadata/sudan/"
// npx hardhat verify --network mainnet 0x1d2f3C725784Cfd977C2255a5944a5DB00201982 "CP.MKT.A1" "CP.MKT.A1" "https://coalapay.org/api/v2/metadata/drc_myanmar_groups/"
// npx hardhat verify --network mainnet 0x01d1760644a90248113b782c0b534a166d5b5f52 "CP.MKT.A1" "CP.MKT.A1" "https://federation.coalapay.org/api/v2/metadata/" "0x8Bd9FFe190066Ba69f699670543161B3cC2E3aaB" "0x6977D98d3A4977441821e882579B41403f60D3bC"